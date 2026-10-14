#!/usr/bin/env python3
"""Recompute the MIE r9 audit from frozen local evidence only.

This runner intentionally does not build guides, contact a terminology service, or use a
publisher JAR.  It reads evidence/r9/<guide>/resources, qa.txt, qa.json, the audit
manifest, and (only for provenance labelling) an author-supplied classification table.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import shutil
import sys
from collections import Counter, defaultdict, deque
from pathlib import Path
from typing import Any, Iterable


class AuditError(RuntimeError):
    """Raised for a malformed or incomplete local audit input."""


CONFORMANCE_TYPES = {
    "StructureDefinition", "ValueSet", "CodeSystem", "ConceptMap", "Questionnaire",
    "SearchParameter", "OperationDefinition", "CapabilityStatement", "ImplementationGuide",
    "NamingSystem", "Requirements",
}
EXPECTED = {
    "profiles": 221, "profiles_foundation": 133, "profiles_programme": 88,
    "valuesets": 213, "codesystems": 51, "questionnaires": 19,
    "questionnaire_responses": 17, "conceptmaps": 7,
    "foundation_derived": 82,
    "all_edges": 525, "all_programme_foundation": 343,
    "all_foundation_foundation": 182,
    "conformance_edges": 404, "conformance_programme_foundation": 237,
    "conformance_foundation_foundation": 167,
    "foundation_use_pairs": 86, "foundation_use_artefacts": 38,
    "programme_questionnaires": 18, "programme_questionnaire_responses": 16,
    "conceptmap_entries": 199, "conceptmap_text_supported": 168,
    "conceptmap_exact_id": 75,
    "portfolio_examples_valid": 369, "portfolio_examples_total": 384,
    "programme_examples_valid": 283, "programme_examples_total": 297,
    "failing_examples": 15, "validation_events": 27,
    "cross_guide_valueset_duplicate_groups": 1,
}


def die(message: str) -> None:
    raise AuditError(message)


def norm_canonical(value: str) -> str:
    """Drop a FHIR canonical version suffix, without changing ordinary URL text."""
    return value.split("|", 1)[0]


def normalize_ws(value: str) -> str:
    return " ".join(value.split())


def csv_write(path: Path, fields: list[str], rows: Iterable[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({key: "" if value is None else value for key, value in row.items()})


def json_write(path: Path, obj: Any) -> None:
    path.write_text(json.dumps(obj, indent=2, sort_keys=True) + "\n", encoding="utf-8", newline="\n")


def safe_id(resource: dict[str, Any], filename: str) -> str:
    resource_type = resource.get("resourceType")
    identifier = resource.get("id") or Path(filename).stem
    if not resource_type:
        die(f"resource without resourceType: {filename}")
    return f"{resource_type}/{identifier}"


def source_identity(guide: str, resource: dict[str, Any], filename: str) -> str:
    """Guide-qualify a source, preventing accidental collisions between guides."""
    local = resource.get("url") if isinstance(resource.get("url"), str) else safe_id(resource, filename)
    return f"{guide}|{local}"


def is_profile(resource: dict[str, Any]) -> bool:
    return (
        resource.get("resourceType") == "StructureDefinition"
        and resource.get("derivation") == "constraint"
        and resource.get("type") != "Extension"
        and resource.get("kind") != "logical"
    )


def field_path(path: str, key: str | int) -> str:
    if isinstance(key, int):
        return f"{path}[{key}]"
    return f"{path}.{key}"


def walk_json_strings(node: Any, path: str = "$") -> Iterable[tuple[str, str]]:
    """Yield every JSON string, including strings held in arrays, with a field path."""
    if isinstance(node, str):
        yield path, node
    elif isinstance(node, list):
        for index, child in enumerate(node):
            yield from walk_json_strings(child, field_path(path, index))
    elif isinstance(node, dict):
        for key, child in node.items():
            yield from walk_json_strings(child, field_path(path, key))


def cross_reference_strings(resource: dict[str, Any]) -> Iterable[tuple[str, str]]:
    """Yield all candidate JSON strings except generated text.div and CM payload nodes.

    The exclusions are intentionally narrow: only $.text.div and ConceptMap
    group[*].element / group[*].target are omitted.  ImplementationGuide resources
    and every other generated JSON resource are included.
    """
    is_cm = resource.get("resourceType") == "ConceptMap"

    def visit(node: Any, path: str) -> Iterable[tuple[str, str]]:
        if isinstance(node, str):
            yield path, node
        elif isinstance(node, list):
            for index, child in enumerate(node):
                yield from visit(child, field_path(path, index))
        elif isinstance(node, dict):
            for key, child in node.items():
                child_path = field_path(path, key)
                # Generated narrative is HTML and may contain URLs not represented as
                # canonical JSON values.
                if path == "$.text" and key == "div":
                    continue
                # Exclude exactly ConceptMap group.element and group.target payloads.
                if is_cm and re.fullmatch(r"\$\.group\[\d+\]", path) and key in {"element", "target"}:
                    continue
                yield from visit(child, child_path)

    yield from visit(resource, "$")


def candidate_canonicals(resource: dict[str, Any]) -> Iterable[tuple[str, str]]:
    for path, value in cross_reference_strings(resource):
        if value.startswith(("http://", "https://")):
            yield path, norm_canonical(value)


def flatten_strings(value: Any) -> Iterable[str]:
    if isinstance(value, str):
        yield value
    elif isinstance(value, list):
        for child in value:
            yield from flatten_strings(child)


def narrow_foundation_references(resource: dict[str, Any]) -> Iterable[tuple[str, str, str]]:
    """Yield only the six declared foundation-use mechanisms.

    Returned tuples are (JSONPath, canonical, mechanism).  ConceptMaps are excluded
    wholesale from this deliberately narrower metric.
    """
    if resource.get("resourceType") == "ConceptMap":
        return

    def direct_strings(value: Any, path: str) -> Iterable[tuple[str, str]]:
        if isinstance(value, str):
            yield path, value
        elif isinstance(value, list):
            for index, child in enumerate(value):
                yield from direct_strings(child, field_path(path, index))

    def visit(node: Any, path: str) -> Iterable[tuple[str, str, str]]:
        if isinstance(node, list):
            for index, child in enumerate(node):
                yield from visit(child, field_path(path, index))
            return
        if not isinstance(node, dict):
            return

        if "baseDefinition" in node:
            for ref_path, value in direct_strings(node["baseDefinition"], field_path(path, "baseDefinition")):
                yield ref_path, norm_canonical(value), "baseDefinition"
        meta = node.get("meta")
        if isinstance(meta, dict) and "profile" in meta:
            for ref_path, value in direct_strings(meta["profile"], field_path(field_path(path, "meta"), "profile")):
                yield ref_path, norm_canonical(value), "meta.profile"
        binding = node.get("binding")
        if isinstance(binding, dict) and "valueSet" in binding:
            for ref_path, value in direct_strings(binding["valueSet"], field_path(field_path(path, "binding"), "valueSet")):
                yield ref_path, norm_canonical(value), "binding.valueSet"
        if "extension" in node:
            extensions = node["extension"]
            extension_items = extensions if isinstance(extensions, list) else [extensions]
            for index, extension in enumerate(extension_items):
                ext_path = field_path(field_path(path, "extension"), index) if isinstance(extensions, list) else field_path(path, "extension")
                if isinstance(extension, dict) and isinstance(extension.get("url"), str):
                    yield field_path(ext_path, "url"), norm_canonical(extension["url"]), "extension.url"
        if "type" in node:
            typed = node["type"]
            type_items = typed if isinstance(typed, list) else [typed]
            for index, type_item in enumerate(type_items):
                type_path = field_path(field_path(path, "type"), index) if isinstance(typed, list) else field_path(path, "type")
                if isinstance(type_item, dict):
                    for key, mechanism in (("profile", "type.profile"), ("targetProfile", "type.targetProfile")):
                        if key in type_item:
                            for ref_path, value in direct_strings(type_item[key], field_path(type_path, key)):
                                yield ref_path, norm_canonical(value), mechanism
        for key, child in node.items():
            yield from visit(child, field_path(path, key))

    yield from visit(resource, "$")


def resource_filename_to_ref(table_path: str) -> str | None:
    normalized = table_path.replace("\\", "/")
    name = normalized.rsplit("/", 1)[-1]
    if name.endswith(".json"):
        name = name[:-5]
    if "-" not in name:
        return None
    resource_type, identifier = name.split("-", 1)
    if not resource_type or not identifier:
        return None
    return f"{resource_type}/{identifier}"


def parse_qa_table(qa_text: str) -> dict[str, dict[str, int]]:
    """Parse per-resource qa.txt counts and retain only named generated resources."""
    result: dict[str, dict[str, int]] = {}
    pattern = re.compile(r"^ (.+?) : (\d+) / (\d+) / (\d+)\s*$")
    for raw_line in qa_text.splitlines():
        if raw_line.strip() == "</table>":
            break
        match = pattern.match(raw_line)
        if not match:
            continue
        ref = resource_filename_to_ref(match.group(1))
        if ref:
            result[ref] = {"errors": int(match.group(2)), "warnings": int(match.group(3)), "info": int(match.group(4))}
    return result


def parse_raw_qa_errors(qa_text: str, qa_counts: dict[str, dict[str, int]]) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
    """Parse every raw ERROR block, then select publisher validation events.

    A raw block begins at ERROR: and absorbs indented/unlabelled continuation lines
    until another severity or a section heading.  The validation selection is strict:
    it must name a generated Resource/id and that resource must have a non-zero QA
    per-resource error count.  This keeps publisher documentation-link errors out of
    the validation metric while preserving a parser for every raw ERROR line.
    """
    lines = qa_text.splitlines()
    raw_events: list[dict[str, str]] = []
    section = "n/a"
    index = 0
    section_re = re.compile(r"^== (.*) ==\s*$")
    severity_re = re.compile(r"^(ERROR|WARNING|INFORMATION|FATAL):\s*(.*)$")
    while index < len(lines):
        line = lines[index]
        section_match = section_re.match(line)
        if section_match:
            section = section_match.group(1).strip()
            index += 1
            continue
        error_match = re.match(r"^ERROR:\s*(.*)$", line)
        if not error_match:
            index += 1
            continue
        message_parts = [error_match.group(1).rstrip()]
        follow = index + 1
        while follow < len(lines):
            next_line = lines[follow]
            if section_re.match(next_line) or severity_re.match(next_line):
                break
            # Tables and blank separators are not error-message continuations.
            if next_line.startswith("<") or next_line.strip() == "":
                break
            message_parts.append(next_line.strip())
            follow += 1
        raw_events.append({"section": section, "message": " ".join(message_parts), "raw_line": str(index + 1)})
        index = follow

    selected: list[dict[str, str]] = []
    resource_prefix = re.compile(r"^([A-Z][A-Za-z0-9]+/[A-Za-z0-9._|-]+):\s*(.*)$")
    for event in raw_events:
        match = resource_prefix.match(event["message"])
        if not match:
            continue
        resource, message = match.group(1), match.group(2)
        if resource in qa_counts and qa_counts[resource]["errors"] > 0:
            selected.append({
                "resource": resource,
                "message": message,
                "section": event["section"],
                "raw_line": event["raw_line"],
            })
    return raw_events, selected


def legacy_example_flag(entry: dict[str, Any]) -> bool:
    return (
        entry.get("isExample") is True
        or entry.get("exampleBoolean") is True
        or isinstance(entry.get("exampleCanonical"), str)
    )


def item_linkids(items: Any) -> set[str]:
    result: set[str] = set()
    if not isinstance(items, list):
        return result
    for item in items:
        if not isinstance(item, dict):
            continue
        if isinstance(item.get("linkId"), str):
            result.add(item["linkId"])
        result.update(item_linkids(item.get("item")))
    return result


def explicit_valueset_membership(vs: dict[str, Any]) -> tuple[str, str, tuple[str, ...] | None]:
    """Return (status, reason, sorted system|code membership) without inferred semantics."""
    compose = vs.get("compose")
    if not isinstance(compose, dict):
        return "excluded", "no-compose", None
    includes = compose.get("include")
    if not isinstance(includes, list) or not includes:
        return "excluded", "no-explicit-includes", None
    excludes = compose.get("exclude")
    if excludes:
        return "excluded", "compose-exclude-present", None
    pairs: set[str] = set()
    for include in includes:
        if not isinstance(include, dict):
            return "excluded", "invalid-include", None
        if not isinstance(include.get("system"), str) or not include["system"]:
            return "excluded", "include-without-system", None
        # Versioned definitions could describe a different membership even if codes
        # happen to match; do not collapse them into an unversioned set.
        if include.get("version") not in (None, ""):
            return "excluded", "include-version-present", None
        if include.get("filter"):
            return "excluded", "include-filter-present", None
        if include.get("valueSet"):
            return "excluded", "include-import-present", None
        concepts = include.get("concept")
        if not isinstance(concepts, list) or not concepts:
            return "excluded", "include-without-explicit-codes", None
        for concept in concepts:
            if not isinstance(concept, dict) or not isinstance(concept.get("code"), str) or not concept["code"]:
                return "excluded", "invalid-explicit-code", None
            pairs.add(f"{include['system']}|{concept['code']}")
    if not pairs:
        return "excluded", "empty-explicit-set", None
    return "evaluated", "explicit-system-code-set", tuple(sorted(pairs))


def read_author_classification(path: Path) -> dict[tuple[str, str, str], dict[str, str]]:
    if not path.is_file():
        die(f"missing author-supplied classification table: {path}")
    result: dict[tuple[str, str, str], dict[str, str]] = {}
    with path.open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            key = (row.get("guide", ""), row.get("resource", ""), normalize_ws(row.get("message", "")))
            if key in result:
                die(f"duplicate author classification key: {key[0]} {key[1]}")
            result[key] = {key: value or "" for key, value in row.items()}
    return result


def load_inputs(input_root: Path, manifest_path: Path) -> tuple[dict[str, Any], dict[str, dict[str, Any]], dict[str, list[dict[str, Any]]], dict[str, str], dict[str, dict[str, Any]]]:
    if not manifest_path.is_file():
        die(f"missing manifest: {manifest_path}")
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        die(f"invalid manifest JSON: {exc}")
    if not isinstance(manifest.get("guides"), list):
        die("manifest has no guides list")
    guide_meta: dict[str, dict[str, Any]] = {}
    for guide in manifest["guides"]:
        if not isinstance(guide, dict) or not guide.get("guide") or guide.get("role") not in {"foundation", "programme"}:
            die("manifest contains an invalid guide record")
        guide_meta[guide["guide"]] = guide

    resources: dict[str, list[dict[str, Any]]] = {}
    qa_text: dict[str, str] = {}
    qa_json: dict[str, dict[str, Any]] = {}
    for guide in guide_meta:
        guide_dir = input_root / guide
        resources_dir = guide_dir / "resources"
        qa_txt_path = guide_dir / "qa.txt"
        qa_json_path = guide_dir / "qa.json"
        if not resources_dir.is_dir():
            die(f"missing resources directory: {resources_dir}")
        if not qa_txt_path.is_file() or not qa_json_path.is_file():
            die(f"missing qa.txt or qa.json for {guide}")
        parsed: list[dict[str, Any]] = []
        files = sorted(resources_dir.rglob("*.json"))
        if not files:
            die(f"no JSON resources for {guide}")
        for file_path in files:
            try:
                resource = json.loads(file_path.read_text(encoding="utf-8"))
            except json.JSONDecodeError as exc:
                die(f"invalid resource JSON {file_path}: {exc}")
            if not isinstance(resource, dict) or not resource.get("resourceType"):
                die(f"not a FHIR resource JSON: {file_path}")
            resource["_audit_filename"] = file_path.name
            parsed.append(resource)
        resources[guide] = parsed
        qa_text[guide] = qa_txt_path.read_text(encoding="utf-8", errors="replace")
        try:
            loaded_qa = json.loads(qa_json_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            die(f"invalid qa.json {qa_json_path}: {exc}")
        if not isinstance(loaded_qa, dict) or not isinstance(loaded_qa.get("errs"), int):
            die(f"qa.json lacks integer errs for {guide}")
        qa_json[guide] = loaded_qa
    return manifest, guide_meta, resources, qa_text, qa_json


def collect_cross_edges(resources: dict[str, list[dict[str, Any]]], guide_meta: dict[str, dict[str, Any]], owner_of: dict[str, str]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Return unique all-resource and conformance-only source-target edges."""
    all_map: dict[tuple[str, str], dict[str, Any]] = {}
    conf_map: dict[tuple[str, str], dict[str, Any]] = {}
    for guide, guide_resources in resources.items():
        for resource in guide_resources:
            filename = resource["_audit_filename"]
            source = source_identity(guide, resource, filename)
            source_ref = resource.get("url") if isinstance(resource.get("url"), str) else safe_id(resource, filename)
            for path, target in candidate_canonicals(resource):
                target_guide = owner_of.get(target)
                if not target_guide or target_guide == guide:
                    continue
                direction = f"{guide_meta[guide]['role']}->{guide_meta[target_guide]['role']}"
                key = (source, target)
                record = all_map.setdefault(key, {
                    "source_guide": guide,
                    "source_role": guide_meta[guide]["role"],
                    "source_identity": source,
                    "source_artefact": source_ref,
                    "source_type": resource["resourceType"],
                    "target_canonical": target,
                    "target_guide": target_guide,
                    "target_role": guide_meta[target_guide]["role"],
                    "direction": direction,
                    "field_paths": set(),
                })
                record["field_paths"].add(path)
                if resource["resourceType"] in CONFORMANCE_TYPES:
                    conf_record = conf_map.setdefault(key, {
                        **{field: value for field, value in record.items() if field != "field_paths"},
                        "field_paths": set(),
                    })
                    conf_record["field_paths"].add(path)
    def finish(records: dict[tuple[str, str], dict[str, Any]]) -> list[dict[str, Any]]:
        finished = []
        for record in records.values():
            output = dict(record)
            output["field_paths"] = " ; ".join(sorted(output["field_paths"]))
            finished.append(output)
        return sorted(finished, key=lambda row: (row["source_identity"], row["target_canonical"]))
    return finish(all_map), finish(conf_map)


def direction_counts(edges: list[dict[str, Any]]) -> Counter[str]:
    return Counter(row["direction"] for row in edges)


def guide_dag(guides: list[str], edges: list[dict[str, Any]]) -> dict[str, Any]:
    adjacency: dict[str, set[str]] = {guide: set() for guide in guides}
    for edge in edges:
        adjacency[edge["source_guide"]].add(edge["target_guide"])
    indegree = {guide: 0 for guide in guides}
    for targets in adjacency.values():
        for target in targets:
            indegree[target] += 1
    queue = deque(sorted(guide for guide, degree in indegree.items() if degree == 0))
    order: list[str] = []
    while queue:
        node = queue.popleft()
        order.append(node)
        for target in sorted(adjacency[node]):
            indegree[target] -= 1
            if indegree[target] == 0:
                queue.append(target)
    cyclic = sorted(guide for guide, degree in indegree.items() if degree > 0)
    return {
        "is_dag": not cyclic,
        "topological_order_source_to_target": order,
        "cyclic_guides": cyclic,
        "guide_edges": [{"source_guide": source, "target_guide": target} for source in sorted(adjacency) for target in sorted(adjacency[source])],
    }


def make_summary(args: argparse.Namespace) -> dict[str, Any]:
    manifest, guide_meta, resources, qa_text, qa_json = load_inputs(args.input, args.manifest)
    author_classification = read_author_classification(args.classification)
    guides = list(guide_meta)

    owner_of: dict[str, str] = {}
    profile_by_url: dict[str, dict[str, Any]] = {}
    for guide, guide_resources in resources.items():
        for resource in guide_resources:
            if isinstance(resource.get("url"), str):
                canonical = norm_canonical(resource["url"])
                if canonical in owner_of and owner_of[canonical] != guide:
                    die(f"canonical is owned by two guides: {canonical}")
                owner_of[canonical] = guide
                if is_profile(resource):
                    profile_by_url[canonical] = resource

    # Artefact counts and profile inheritance.
    artefact_rows: list[dict[str, Any]] = []
    inheritance_rows: list[dict[str, Any]] = []
    counts = Counter()
    for guide, guide_resources in resources.items():
        role = guide_meta[guide]["role"]
        local = {
            "profiles": sum(is_profile(resource) for resource in guide_resources),
            "extensions": sum(resource.get("resourceType") == "StructureDefinition" and resource.get("type") == "Extension" for resource in guide_resources),
            "valuesets": sum(resource.get("resourceType") == "ValueSet" for resource in guide_resources),
            "codesystems": sum(resource.get("resourceType") == "CodeSystem" for resource in guide_resources),
            "questionnaires": sum(resource.get("resourceType") == "Questionnaire" for resource in guide_resources),
            "questionnaire_responses": sum(resource.get("resourceType") == "QuestionnaireResponse" for resource in guide_resources),
            "conceptmaps": sum(resource.get("resourceType") == "ConceptMap" for resource in guide_resources),
        }
        artefact_rows.append({"guide": guide, "role": role, **local})
        for key, value in local.items():
            counts[key] += value
            counts[f"{key}_{role}"] += value
        for resource in guide_resources:
            if not is_profile(resource):
                continue
            base = norm_canonical(resource["baseDefinition"]) if isinstance(resource.get("baseDefinition"), str) else ""
            owner = owner_of.get(base, "")
            if role == "foundation":
                classification = "foundation-profile"
            elif not base:
                classification = "unresolved"
            elif owner and guide_meta[owner]["role"] == "foundation":
                classification = "foundation-derived"
            elif owner == guide:
                classification = "same-programme"
            elif owner:
                classification = "other-programme"
            elif "hl7.eu/fhir" in base:
                classification = "hl7-europe-external"
            elif base.startswith("http://hl7.org/fhir/StructureDefinition/"):
                classification = "fhir-r5-core"
            else:
                classification = "unresolved"
            inheritance_rows.append({
                "guide": guide, "role": role, "profile_id": resource.get("id", ""),
                "profile_url": resource.get("url", ""), "base_definition": base,
                "base_owner": owner, "classification": classification,
            })

    all_edges, conformance_edges = collect_cross_edges(resources, guide_meta, owner_of)
    all_directions = direction_counts(all_edges)
    conformance_directions = direction_counts(conformance_edges)
    dag = guide_dag(guides, all_edges)

    # Narrow foundation-use observations with raw field-level evidence retained.
    foundation_rows: list[dict[str, Any]] = []
    foundation_pairs: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for guide, guide_resources in resources.items():
        if guide_meta[guide]["role"] != "programme":
            continue
        for resource in guide_resources:
            filename = resource["_audit_filename"]
            for path, target, mechanism in narrow_foundation_references(resource):
                target_guide = owner_of.get(target)
                if not target_guide or guide_meta[target_guide]["role"] != "foundation":
                    continue
                row = {
                    "programme_guide": guide,
                    "source_identity": source_identity(guide, resource, filename),
                    "source_artefact": resource.get("url") if isinstance(resource.get("url"), str) else safe_id(resource, filename),
                    "source_type": resource["resourceType"],
                    "field_path": path,
                    "mechanism": mechanism,
                    "foundation_canonical": target,
                    "foundation_guide": target_guide,
                }
                foundation_rows.append(row)
                foundation_pairs[(target, guide)].append(row)
    foundation_summary_rows = []
    for (target, programme), rows in sorted(foundation_pairs.items()):
        foundation_summary_rows.append({
            "foundation_canonical": target,
            "programme_guide": programme,
            "foundation_guide": rows[0]["foundation_guide"],
            "observation_count": len(rows),
            "mechanisms": " ; ".join(sorted({row["mechanism"] for row in rows})),
            "field_paths": " ; ".join(sorted({row["field_path"] for row in rows})),
        })

    # Explicit ValueSet system|code membership only.
    valueset_rows: list[dict[str, Any]] = []
    value_memberships: dict[tuple[str, ...], list[dict[str, Any]]] = defaultdict(list)
    for guide, guide_resources in resources.items():
        for resource in guide_resources:
            if resource.get("resourceType") != "ValueSet":
                continue
            status, reason, membership = explicit_valueset_membership(resource)
            row = {
                "guide": guide, "role": guide_meta[guide]["role"], "valueset_id": resource.get("id", ""),
                "valueset_url": resource.get("url", ""), "status": status, "reason": reason,
                "explicit_pair_count": len(membership) if membership else 0,
                "explicit_system_code_pairs": " ".join(membership or ()),
            }
            valueset_rows.append(row)
            if membership:
                value_memberships[membership].append(row)
    valueset_duplicate_rows: list[dict[str, Any]] = []
    for membership, rows in sorted(value_memberships.items(), key=lambda item: (len(item[1]), item[0]), reverse=True):
        if len(rows) < 2:
            continue
        guide_set = sorted({row["guide"] for row in rows})
        valueset_duplicate_rows.append({
            "cross_guide": "yes" if len(guide_set) > 1 else "no",
            "sets_sharing": len(rows), "guides": " ".join(guide_set),
            "sets": " == ".join(f"{row['guide']}:{row['valueset_id']}" for row in sorted(rows, key=lambda row: (row['guide'], row['valueset_id']))),
            "explicit_system_code_pairs": " ".join(membership),
        })

    # Questionnaires, QuestionnaireResponses, canonical matches and recursive linkIds.
    questionnaire_rows: list[dict[str, Any]] = []
    questionnaires_by_canonical: dict[str, dict[str, Any]] = {}
    responses: list[tuple[str, dict[str, Any]]] = []
    for guide, guide_resources in resources.items():
        role = guide_meta[guide]["role"]
        for resource in guide_resources:
            kind = resource.get("resourceType")
            if kind == "Questionnaire":
                canonical = resource.get("url", "")
                questionnaire_rows.append({"guide": guide, "role": role, "resource_type": kind, "id": resource.get("id", ""), "canonical_or_questionnaire": canonical, "top_level_items": len(resource.get("item", [])) if isinstance(resource.get("item"), list) else 0})
                if isinstance(canonical, str) and canonical:
                    questionnaires_by_canonical[norm_canonical(canonical)] = {"guide": guide, "resource": resource}
            elif kind == "QuestionnaireResponse":
                reference = resource.get("questionnaire", "")
                questionnaire_rows.append({"guide": guide, "role": role, "resource_type": kind, "id": resource.get("id", ""), "canonical_or_questionnaire": reference, "top_level_items": len(resource.get("item", [])) if isinstance(resource.get("item"), list) else 0})
                responses.append((guide, resource))
    questionnaire_match_rows: list[dict[str, Any]] = []
    linkid_rows: list[dict[str, Any]] = []
    for guide, response in responses:
        reference = response.get("questionnaire", "")
        target = questionnaires_by_canonical.get(norm_canonical(reference)) if isinstance(reference, str) else None
        matched = target is not None
        target_resource = target["resource"] if target else None
        response_ids = item_linkids(response.get("item"))
        questionnaire_ids = item_linkids(target_resource.get("item")) if target_resource else set()
        unknown_ids = sorted(response_ids - questionnaire_ids) if target_resource else sorted(response_ids)
        match_status = "matched" if matched else "unmatched-questionnaire-canonical"
        questionnaire_match_rows.append({
            "response_guide": guide, "response_role": guide_meta[guide]["role"], "response_id": response.get("id", ""),
            "questionnaire_canonical": reference, "questionnaire_guide": target["guide"] if target else "",
            "questionnaire_id": target_resource.get("id", "") if target_resource else "", "match_status": match_status,
        })
        linkid_rows.append({
            "response_guide": guide, "response_id": response.get("id", ""), "questionnaire_canonical": reference,
            "questionnaire_id": target_resource.get("id", "") if target_resource else "", "response_recursive_linkid_count": len(response_ids),
            "questionnaire_recursive_linkid_count": len(questionnaire_ids), "linkids_subset_of_questionnaire": "yes" if matched and not unknown_ids else "no",
            "unknown_response_linkids": " ; ".join(unknown_ids),
        })

    # ConceptMap target heuristic: text-supported association, deliberately not equivalence.
    profile_ids: dict[str, list[dict[str, Any]]] = defaultdict(list)
    all_profile_ids: set[str] = set()
    profile_names: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for guide, guide_resources in resources.items():
        for resource in guide_resources:
            if is_profile(resource):
                identity = {"guide": guide, "id": resource.get("id", ""), "url": resource.get("url", ""), "name": resource.get("name", "")}
                if isinstance(identity["id"], str) and identity["id"]:
                    all_profile_ids.add(identity["id"])
                if len(identity["id"]) > 6:
                    profile_ids[identity["id"]].append(identity)
                if isinstance(identity["name"], str) and len(identity["name"]) > 6:
                    profile_names[identity["name"]].append(identity)
    conceptmap_rows: list[dict[str, Any]] = []
    for guide, guide_resources in resources.items():
        for cm in guide_resources:
            if cm.get("resourceType") != "ConceptMap":
                continue
            for group_index, group in enumerate(cm.get("group", []) if isinstance(cm.get("group"), list) else []):
                if not isinstance(group, dict):
                    continue
                for element_index, element in enumerate(group.get("element", []) if isinstance(group.get("element"), list) else []):
                    if not isinstance(element, dict):
                        continue
                    for target_index, target in enumerate(element.get("target", []) if isinstance(element.get("target"), list) else []):
                        if not isinstance(target, dict):
                            continue
                        code = target.get("code", "") if isinstance(target.get("code"), str) else ""
                        display = target.get("display", "") if isinstance(target.get("display"), str) else ""
                        comment = target.get("comment", "") if isinstance(target.get("comment"), str) else ""
                        text = " ".join(piece for piece in (code, display, comment) if piece)
                        hits: dict[tuple[str, str], set[str]] = defaultdict(set)
                        # A URI in a prose comment can name an incidental page or
                        # binding.  For this heuristic, canonical association is
                        # reserved for a canonical in the target code itself;
                        # otherwise match only a known profile id/name longer than
                        # six characters in code/display/comment.
                        if code in profile_by_url:
                            profile = profile_by_url[code]
                            hits[(profile.get("id", ""), code)].add("canonical-target-code")
                        for known, profiles in profile_ids.items():
                            if known in text:
                                for profile in profiles:
                                    hits[(profile["id"], profile["url"])].add("profile-id-mentioned")
                        for known, profiles in profile_names.items():
                            if known in text:
                                for profile in profiles:
                                    hits[(profile["id"], profile["url"])].add("profile-name-mentioned")
                        matched_ids = sorted({identifier for identifier, _url in hits})
                        reasons = sorted({reason for reasons in hits.values() for reason in reasons})
                        exact_id = code in all_profile_ids
                        classification = "text-supported-profile-association" if (hits or exact_id) else "no-text-supported-profile-association"
                        conceptmap_rows.append({
                            "guide": guide, "conceptmap_id": cm.get("id", ""), "group_index": group_index,
                            "element_index": element_index, "target_index": target_index,
                            "group_source": group.get("source", ""), "group_target": group.get("target", ""),
                            "source_code": element.get("code", ""), "source_display": element.get("display", ""),
                            "target_code": code, "target_display": display, "target_comment": comment,
                            "relationship": target.get("relationship", ""), "classification": classification,
                            "exact_profile_id_target": "yes" if exact_id else "no",
                            "matched_profile_ids": " ; ".join(matched_ids), "match_reasons": " ; ".join(reasons),
                            # A text mention is not a semantic equivalence assertion; flag
                            # every positive automated association for author review.
                            "ambiguous_association": "yes" if hits else "no",
                        })

    # Examples come only from the generated ImplementationGuide resource list.  A missing
    # QA table entry is an input error, never silently treated as zero validation errors.
    validation_summary_rows: list[dict[str, Any]] = []
    failing_example_rows: list[dict[str, Any]] = []
    validation_event_rows: list[dict[str, Any]] = []
    raw_error_rows: list[dict[str, Any]] = []
    matched_author_keys: set[tuple[str, str, str]] = set()
    for guide, guide_resources in resources.items():
        role = guide_meta[guide]["role"]
        qa_counts = parse_qa_table(qa_text[guide])
        raw_errors, validation_events = parse_raw_qa_errors(qa_text[guide], qa_counts)
        for event in raw_errors:
            raw_error_rows.append({"guide": guide, "role": role, **event})
        if len(validation_events) != qa_json[guide]["errs"]:
            die(f"QA error mismatch for {guide}: qa.json says {qa_json[guide]['errs']}, parsed {len(validation_events)} validation ERROR events")
        for event in validation_events:
            key = (guide, event["resource"], normalize_ws(event["message"]))
            supplied = author_classification.get(key)
            if supplied:
                matched_author_keys.add(key)
                matching_status = "matched-after-whitespace-normalization"
                cause = supplied.get("cause", "")
                cause_explanation = supplied.get("cause_explanation", "")
            else:
                matching_status = "no-author-supplied-message-match"
                cause = ""
                cause_explanation = ""
            validation_event_rows.append({
                "guide": guide, "role": role, "resource": event["resource"],
                "qa_section": event["section"], "qa_raw_line": event["raw_line"],
                "message": event["message"], "message_normalized": normalize_ws(event["message"]),
                "author_classification_status": matching_status,
                "author_supplied_cause": cause,
                "author_supplied_cause_explanation": cause_explanation,
                "classification_provenance": "AUTHOR-SUPPLIED; joined from author_supplied/validation_errors.csv; not independently proven by this runner",
            })
        implementation_guides = [resource for resource in guide_resources if resource.get("resourceType") == "ImplementationGuide"]
        if len(implementation_guides) != 1:
            die(f"expected exactly one ImplementationGuide JSON in {guide}; found {len(implementation_guides)}")
        examples = [entry for entry in implementation_guides[0].get("definition", {}).get("resource", []) if isinstance(entry, dict) and legacy_example_flag(entry)]
        valid = 0
        for entry in examples:
            reference = entry.get("reference", {}).get("reference", "") if isinstance(entry.get("reference"), dict) else ""
            if not isinstance(reference, str) or not reference:
                die(f"example without reference in {guide} ImplementationGuide")
            if reference not in qa_counts:
                die(f"missing QA per-resource entry for listed example {guide} {reference}")
            errors = qa_counts[reference]["errors"]
            if errors == 0:
                valid += 1
            else:
                failing_example_rows.append({
                    "guide": guide, "role": role, "resource": reference,
                    "qa_errors": errors, "qa_warnings": qa_counts[reference]["warnings"],
                    "qa_info": qa_counts[reference]["info"],
                })
        total = len(examples)
        validation_summary_rows.append({
            "guide": guide, "role": role, "examples_valid": valid, "examples_total": total,
            "examples_invalid": total - valid, "percent_valid": f"{(100 * valid / total):.1f}" if total else "N/A",
            "validation_error_events": len(validation_events), "qa_json_errs": qa_json[guide]["errs"],
        })

    # A local existence/readability test for the published dgr evidence; no JAR is run.
    dgr_output = args.input.parent / "dgr1" / "output.txt"
    dgr_status = {
        "path": str(dgr_output), "published_test_present": dgr_output.is_file(),
        "fresh_jar_run": False,
        "contains_multi_item_throw": False,
    }
    if dgr_output.is_file():
        dgr_text = dgr_output.read_text(encoding="utf-8", errors="replace")
        dgr_status["contains_multi_item_throw"] = "multi -> THREW PathEngineException" in dgr_text

    # Assertions represent expected characteristics of the frozen r9 dataset, not a fresh build.
    portfolio_valid = sum(int(row["examples_valid"]) for row in validation_summary_rows)
    portfolio_total = sum(int(row["examples_total"]) for row in validation_summary_rows)
    programme_valid = sum(int(row["examples_valid"]) for row in validation_summary_rows if row["role"] == "programme")
    programme_total = sum(int(row["examples_total"]) for row in validation_summary_rows if row["role"] == "programme")
    computed = {
        "profiles": counts["profiles"], "profiles_foundation": counts["profiles_foundation"], "profiles_programme": counts["profiles_programme"],
        "valuesets": counts["valuesets"], "codesystems": counts["codesystems"], "questionnaires": counts["questionnaires"],
        "questionnaire_responses": counts["questionnaire_responses"], "conceptmaps": counts["conceptmaps"],
        "foundation_derived": sum(row["classification"] == "foundation-derived" for row in inheritance_rows),
        "all_edges": len(all_edges), "all_programme_foundation": all_directions["programme->foundation"],
        "all_foundation_foundation": all_directions["foundation->foundation"],
        "conformance_edges": len(conformance_edges), "conformance_programme_foundation": conformance_directions["programme->foundation"],
        "conformance_foundation_foundation": conformance_directions["foundation->foundation"],
        "foundation_use_pairs": len(foundation_pairs), "foundation_use_artefacts": len({target for target, _programme in foundation_pairs}),
        "programme_questionnaires": sum(row["resource_type"] == "Questionnaire" and row["role"] == "programme" for row in questionnaire_rows),
        "programme_questionnaire_responses": sum(row["resource_type"] == "QuestionnaireResponse" and row["role"] == "programme" for row in questionnaire_rows),
        "conceptmap_entries": len(conceptmap_rows),
        "conceptmap_text_supported": sum(row["classification"] == "text-supported-profile-association" for row in conceptmap_rows),
        "conceptmap_exact_id": sum(row["exact_profile_id_target"] == "yes" for row in conceptmap_rows),
        "portfolio_examples_valid": portfolio_valid, "portfolio_examples_total": portfolio_total,
        "programme_examples_valid": programme_valid, "programme_examples_total": programme_total,
        "failing_examples": len(failing_example_rows), "validation_events": len(validation_event_rows),
        "cross_guide_valueset_duplicate_groups": sum(row["cross_guide"] == "yes" for row in valueset_duplicate_rows),
    }
    assertion_rows = []
    failures = []
    for name, expected in EXPECTED.items():
        actual = computed[name]
        status = "PASS" if actual == expected else "FAIL"
        assertion_rows.append({"assertion": name, "expected": expected, "actual": actual, "status": status})
        if status == "FAIL":
            failures.append(f"{name}: expected {expected}, got {actual}")
    dag_status = "PASS" if dag["is_dag"] else "FAIL"
    assertion_rows.append({"assertion": "guide_dependency_graph_is_dag", "expected": True, "actual": dag["is_dag"], "status": dag_status})
    if not dag["is_dag"]:
        failures.append("guide dependency graph is cyclic: " + ", ".join(dag["cyclic_guides"]))
    if not dgr_status["published_test_present"] or not dgr_status["contains_multi_item_throw"]:
        failures.append("published dgr evidence test is missing or does not contain expected probe output")
    unmatched_author_rows = [key for key in author_classification if key not in matched_author_keys]
    if unmatched_author_rows:
        failures.append(f"{len(unmatched_author_rows)} author-supplied validation classification row(s) did not match parsed QA events")
    unmatched_events = [row for row in validation_event_rows if row["author_classification_status"] != "matched-after-whitespace-normalization"]
    if unmatched_events:
        failures.append(f"{len(unmatched_events)} parsed validation event(s) lack author-supplied classification matches")

    # Deterministic exports.
    output = args.output
    output.mkdir(parents=True, exist_ok=True)
    csv_write(output / "artefact_counts.csv", ["guide", "role", "profiles", "extensions", "valuesets", "codesystems", "questionnaires", "questionnaire_responses", "conceptmaps"], sorted(artefact_rows, key=lambda row: row["guide"]))
    csv_write(output / "profile_inheritance.csv", ["guide", "role", "profile_id", "profile_url", "base_definition", "base_owner", "classification"], sorted(inheritance_rows, key=lambda row: (row["guide"], row["profile_id"])))
    edge_fields = ["source_guide", "source_role", "source_identity", "source_artefact", "source_type", "target_canonical", "target_guide", "target_role", "direction", "field_paths"]
    csv_write(output / "canonical_reference_edges.csv", edge_fields, all_edges)
    csv_write(output / "canonical_reference_edges_conformance.csv", edge_fields, conformance_edges)
    csv_write(output / "foundation_use_rows.csv", ["programme_guide", "source_identity", "source_artefact", "source_type", "field_path", "mechanism", "foundation_canonical", "foundation_guide"], sorted(foundation_rows, key=lambda row: (row["foundation_canonical"], row["programme_guide"], row["source_identity"], row["field_path"])))
    csv_write(output / "foundation_use_observations.csv", ["foundation_canonical", "programme_guide", "foundation_guide", "observation_count", "mechanisms", "field_paths"], foundation_summary_rows)
    csv_write(output / "valueset_explicit_memberships.csv", ["guide", "role", "valueset_id", "valueset_url", "status", "reason", "explicit_pair_count", "explicit_system_code_pairs"], sorted(valueset_rows, key=lambda row: (row["guide"], row["valueset_id"])))
    csv_write(output / "valueset_duplicates_explicit.csv", ["cross_guide", "sets_sharing", "guides", "sets", "explicit_system_code_pairs"], valueset_duplicate_rows)
    csv_write(output / "questionnaires_and_responses.csv", ["guide", "role", "resource_type", "id", "canonical_or_questionnaire", "top_level_items"], sorted(questionnaire_rows, key=lambda row: (row["guide"], row["resource_type"], row["id"])))
    csv_write(output / "questionnaire_response_matches.csv", ["response_guide", "response_role", "response_id", "questionnaire_canonical", "questionnaire_guide", "questionnaire_id", "match_status"], sorted(questionnaire_match_rows, key=lambda row: (row["response_guide"], row["response_id"])))
    csv_write(output / "questionnaire_response_linkids.csv", ["response_guide", "response_id", "questionnaire_canonical", "questionnaire_id", "response_recursive_linkid_count", "questionnaire_recursive_linkid_count", "linkids_subset_of_questionnaire", "unknown_response_linkids"], sorted(linkid_rows, key=lambda row: (row["response_guide"], row["response_id"])))
    csv_write(output / "conceptmap_entries.csv", ["guide", "conceptmap_id", "group_index", "element_index", "target_index", "group_source", "group_target", "source_code", "source_display", "target_code", "target_display", "target_comment", "relationship", "classification", "exact_profile_id_target", "matched_profile_ids", "match_reasons", "ambiguous_association"], conceptmap_rows)
    csv_write(output / "validation_summary.csv", ["guide", "role", "examples_valid", "examples_total", "examples_invalid", "percent_valid", "validation_error_events", "qa_json_errs"], sorted(validation_summary_rows, key=lambda row: row["guide"]))
    csv_write(output / "failing_examples.csv", ["guide", "role", "resource", "qa_errors", "qa_warnings", "qa_info"], sorted(failing_example_rows, key=lambda row: (row["guide"], row["resource"])))
    csv_write(output / "validation_error_events.csv", ["guide", "role", "resource", "qa_section", "qa_raw_line", "message", "message_normalized", "author_classification_status", "author_supplied_cause", "author_supplied_cause_explanation", "classification_provenance"], validation_event_rows)
    csv_write(output / "raw_qa_error_events.csv", ["guide", "role", "section", "raw_line", "message"], raw_error_rows)
    csv_write(output / "assertions.csv", ["assertion", "expected", "actual", "status"], assertion_rows)
    json_write(output / "guide_dependency_dag.json", dag)
    summary = {
        "snapshot": manifest.get("snapshot"), "input": Path(args.input).as_posix(), "manifest": str(args.manifest),
        "analysis_is_local_only": True, "fresh_build_performed": False,
        "source_hashes_recomputed": False,
        "source_hash_note": "Manifest sourceSha256 values are recorded provenance; they cannot be recomputed without the original guide checkouts.",
        "counts": computed,
        "cross_guide": {"all_directions": dict(sorted(all_directions.items())), "conformance_directions": dict(sorted(conformance_directions.items())), "dag": dag},
        "foundation_use_scope": ["baseDefinition", "type.profile", "type.targetProfile", "meta.profile", "extension.url", "binding.valueSet"],
        "valueset_metric": {"evaluated_explicit_sets": sum(row["status"] == "evaluated" for row in valueset_rows), "excluded_non_explicit_sets": sum(row["status"] != "evaluated" for row in valueset_rows), "cross_guide_duplicate_groups": computed["cross_guide_valueset_duplicate_groups"]},
        "conceptmap_metric": {"wording": "text-supported profile association; not guaranteed equivalence", "positive_rows": computed["conceptmap_text_supported"], "exact_id_rows": computed["conceptmap_exact_id"], "ambiguous_positive_rows": sum(row["ambiguous_association"] == "yes" for row in conceptmap_rows)},
        "validation": {"raw_error_lines_parsed": len(raw_error_rows), "validation_events": len(validation_event_rows), "author_classification_matches": len(matched_author_keys), "author_classification_unmatched_rows": len(unmatched_author_rows), "event_unmatched": len(unmatched_events)},
        "dgr_evidence": dgr_status,
        "assertions_pass": not failures, "failures": failures,
    }
    json_write(output / "summary.json", summary)
    report_lines = [
        "# Local recomputation summary", "",
        "This report is computed from frozen local r9 evidence only. It performs **no fresh guide build**, no terminology lookup, and no SNOMED verification.", "",
        "## Assertions", "", "| Assertion | Expected | Actual | Status |", "|---|---:|---:|---|",
    ]
    report_lines.extend(f"| {row['assertion']} | {row['expected']} | {row['actual']} | {row['status']} |" for row in assertion_rows)
    report_lines.extend([
        "", "## Key local results", "",
        f"- Profiles: **{computed['profiles']}** ({computed['profiles_foundation']} foundation; {computed['profiles_programme']} programme); {computed['foundation_derived']} programme profiles immediately foundation-derived.",
        f"- Cross-guide edges: **{computed['all_edges']}** = {computed['all_programme_foundation']} programme→foundation + {computed['all_foundation_foundation']} foundation→foundation; forbidden directions programme→programme and foundation→programme are **0**. Conformance-only: **{computed['conformance_edges']}** = {computed['conformance_programme_foundation']} + {computed['conformance_foundation_foundation']}. Guide graph DAG: **{dag['is_dag']}**.",
        f"- Narrow foundation-use observations: **{computed['foundation_use_pairs']}** pairs served by **{computed['foundation_use_artefacts']}** foundation artefacts.",
        f"- Examples valid: **{portfolio_valid}/{portfolio_total}** portfolio; **{programme_valid}/{programme_total}** programme; failing examples: **{len(failing_example_rows)}**; parsed validation events: **{len(validation_event_rows)}**.",
        f"- ConceptMaps: **{computed['conceptmaps']}** maps / **{computed['conceptmap_entries']}** entries; **{computed['conceptmap_text_supported']}** text-supported profile associations, including **{computed['conceptmap_exact_id']}** exact target IDs. These associations are not guaranteed semantic equivalence and positives are ambiguity-flagged.",
        f"- Explicit ValueSet system|code sets: {summary['valueset_metric']['evaluated_explicit_sets']} evaluated; {summary['valueset_metric']['excluded_non_explicit_sets']} non-explicit sets excluded; cross-guide duplicate groups: {computed['cross_guide_valueset_duplicate_groups']}.",
        "", "## Classification caveat", "",
        "`validation_error_events.csv` joins cause labels from the supplied historical table after whitespace-normalized message matching. The labels are **AUTHOR-SUPPLIED** and are not independent proof of a SNOMED edition or of any external condition.",
    ])
    (output / "RECOMPUTATION_SUMMARY.md").write_text("\n".join(report_lines) + "\n", encoding="utf-8")
    return summary


def write_hashes(package_root: Path) -> None:
    """Hash every regular package file except hashes.txt itself, deterministically."""
    hash_path = package_root / "hashes.txt"
    rows: list[str] = []
    for file_path in sorted(package_root.rglob("*")):
        if not file_path.is_file() or file_path.is_symlink() or file_path == hash_path:
            continue
        # Interpreter caches appear as soon as anyone runs the tests, and would otherwise
        # make a correct package fail its own integrity check.
        if "__pycache__" in file_path.parts:
            continue
        digest = hashlib.sha256(file_path.read_bytes()).hexdigest()
        rows.append(f"{digest}  {file_path.relative_to(package_root).as_posix()}")
    hash_path.write_text("\n".join(rows) + "\n", encoding="utf-8", newline="\n")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Recompute the local MIE r9 audit snapshot without dependencies.")
    parser.add_argument("--input", type=Path, default=Path("evidence/r9"), help="frozen r9 evidence directory")
    parser.add_argument("--output", type=Path, default=Path("results"), help="directory for regenerated result tables")
    parser.add_argument("--manifest", type=Path, default=Path("audit_manifest.json"), help="snapshot manifest")
    parser.add_argument("--classification", type=Path, default=Path("author_supplied/validation_errors.csv"), help="author-supplied classification CSV")
    parser.add_argument("--no-hashes", action="store_true", help="do not regenerate package-root hashes.txt")
    args = parser.parse_args(argv)
    try:
        summary = make_summary(args)
        if not args.no_hashes:
            write_hashes(args.output.parent)
    except AuditError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    if not summary["assertions_pass"]:
        print("ERROR: frozen-dataset assertion(s) failed: " + "; ".join(summary["failures"]), file=sys.stderr)
        return 1
    print("PASS: recomputed local r9 snapshot; results written to " + str(args.output))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
