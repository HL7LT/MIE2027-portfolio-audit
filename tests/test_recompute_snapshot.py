#!/usr/bin/env python3
"""Regression tests for the local, dependency-free r9 recomputation runner."""
from __future__ import annotations

import csv
import importlib.util
import json
import shutil
import tempfile
import unittest
from pathlib import Path

PACKAGE = Path(__file__).resolve().parents[1]
RUNNER_PATH = PACKAGE / "scripts" / "recompute_snapshot.py"
SPEC = importlib.util.spec_from_file_location("recompute_snapshot", RUNNER_PATH)
assert SPEC and SPEC.loader
runner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runner)


class TraversalAndScopeTests(unittest.TestCase):
    def test_array_strings_are_walked_and_versions_stripped(self) -> None:
        resource = {
            "resourceType": "Observation", "id": "x",
            "subject": {"extension": [{"valueCanonical": "https://inside.example/a|2.0"}]},
            "note": ["https://inside.example/b|1"],
        }
        found = set(runner.candidate_canonicals(resource))
        self.assertIn(("$.subject.extension[0].valueCanonical", "https://inside.example/a"), found)
        self.assertIn(("$.note[0]", "https://inside.example/b"), found)

    def test_source_identity_is_guide_qualified(self) -> None:
        resource = {"resourceType": "Observation", "id": "same-id"}
        left = runner.source_identity("ig-left", resource, "Observation-same-id.json")
        right = runner.source_identity("ig-right", resource, "Observation-same-id.json")
        self.assertNotEqual(left, right)
        self.assertEqual(left, "ig-left|Observation/same-id")

    def test_conceptmap_excludes_only_group_element_and_target_payload(self) -> None:
        conceptmap = {
            "resourceType": "ConceptMap", "id": "cm",
            "url": "https://inside.example/ConceptMap/cm",
            "sourceScopeCanonical": "https://inside.example/ValueSet/kept",
            "text": {"div": "<p>https://inside.example/ignored-narrative</p>"},
            "group": [{
                "source": "https://inside.example/CodeSystem/kept",
                "element": [{"code": "https://inside.example/StructureDefinition/excluded-element", "target": [{"code": "https://inside.example/StructureDefinition/excluded-target"}]}],
            }],
        }
        found = {value for _path, value in runner.candidate_canonicals(conceptmap)}
        self.assertIn("https://inside.example/ValueSet/kept", found)
        self.assertIn("https://inside.example/CodeSystem/kept", found)
        self.assertNotIn("https://inside.example/StructureDefinition/excluded-element", found)
        self.assertNotIn("https://inside.example/StructureDefinition/excluded-target", found)
        self.assertNotIn("https://inside.example/ignored-narrative", found)

    def test_unknown_canonicals_do_not_make_edges(self) -> None:
        resources = {"left": [{"resourceType": "Observation", "id": "x", "url": "https://left/x", "_audit_filename": "Observation-x.json", "focus": [{"reference": "https://outside.example/not-owned"}]}], "right": []}
        meta = {"left": {"role": "programme"}, "right": {"role": "foundation"}}
        all_edges, conformance_edges = runner.collect_cross_edges(resources, meta, {"https://left/x": "left"})
        self.assertEqual(all_edges, [])
        self.assertEqual(conformance_edges, [])

    def test_narrow_foundation_use_ignores_broader_canonical_fields(self) -> None:
        resource = {
            "resourceType": "Observation", "id": "x", "url": "https://mine/x",
            "subject": {"reference": "https://foundation.example/not-counted"},
            "extension": [{"url": "https://foundation.example/count-me"}],
            "meta": {"profile": ["https://foundation.example/meta|1"]},
        }
        found = {(path, canonical, mechanism) for path, canonical, mechanism in runner.narrow_foundation_references(resource)}
        self.assertIn(("$.extension[0].url", "https://foundation.example/count-me", "extension.url"), found)
        self.assertIn(("$.meta.profile[0]", "https://foundation.example/meta", "meta.profile"), found)
        self.assertFalse(any("subject" in path for path, _canonical, _mechanism in found))

    def test_qa_error_parser_retains_continuation_and_selects_nonzero_resource(self) -> None:
        qa = """err = 1, warn = 0, info = 0
 C:\\x\\fsh-generated\\resources\\Observation-example : 1 / 0 / 0
</table>
== fsh-generated\\resources\\Observation-example.json ==
ERROR: Observation/example: first line
  continuation detail
== n/a ==
ERROR: page.html at Line 1: documentation error
"""
        counts = runner.parse_qa_table(qa)
        raw, selected = runner.parse_raw_qa_errors(qa, counts)
        self.assertEqual(len(raw), 2)
        self.assertIn("continuation detail", raw[0]["message"])
        self.assertEqual(len(selected), 1)
        self.assertEqual(selected[0]["resource"], "Observation/example")


class RunnerFailureTests(unittest.TestCase):
    def test_missing_input_returns_nonzero(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            temp_path = Path(temp)
            code = runner.main([
                "--input", str(temp_path / "missing"),
                "--output", str(temp_path / "results"),
                "--manifest", str(temp_path / "missing-manifest.json"),
                "--classification", str(temp_path / "missing-classification.csv"),
                "--no-hashes",
            ])
        self.assertEqual(code, 2)

    def test_dataset_assertions_pass(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            out = Path(temp) / "results"
            code = runner.main([
                "--input", str(PACKAGE / "evidence" / "r9"),
                "--output", str(out),
                "--manifest", str(PACKAGE / "audit_manifest.json"),
                "--classification", str(PACKAGE / "author_supplied" / "validation_errors.csv"),
                "--no-hashes",
            ])
            self.assertEqual(code, 0)
            with (out / "assertions.csv").open(encoding="utf-8") as handle:
                rows = list(csv.DictReader(handle))
            self.assertTrue(rows)
            self.assertTrue(all(row["status"] == "PASS" for row in rows))
            summary = json.loads((out / "summary.json").read_text(encoding="utf-8"))
            self.assertEqual(summary["counts"]["all_edges"], 525)
            self.assertEqual(summary["counts"]["conformance_edges"], 404)
            self.assertTrue(summary["cross_guide"]["dag"]["is_dag"])


if __name__ == "__main__":
    unittest.main()
