# MIE paper audit candidate v1.1 (local, unpublished)

This is a **local candidate audit package** for the MIE paper. It is not published and the runner never uses a browser, network service, fresh source checkout, terminology service, Publisher JAR, or a new guide build.

It replaces the historical collection of JavaScript scripts with one dependency-free Python 3 canonical runner. Historical v1.0 is retained as provenance only at:

```text
https://github.com/HL7LT/MIE2027-portfolio-audit/releases/tag/v1.0
```

The v1.0 JavaScript is deliberately **not copied as active candidate code**. Its fragmented source-path assumptions and broad/mis-scoped measures are replaced by the unified runner below.

## Run locally

From this package root:

```bash
python3 scripts/recompute_snapshot.py --input evidence/r9 --output results
python3 -m unittest discover -s tests
```

Python 3 standard library is the only dependency. The runner reads `evidence/r9/<guide>/resources/`, `qa.txt`, `qa.json`, `audit_manifest.json`, and `author_supplied/validation_errors.csv`. It fails rather than guessing if an expected input or a QA row for a listed example is missing.

Each successful run writes fresh result CSV/JSON/Markdown exports under `results/` and regenerates `hashes.txt`. `hashes.txt` covers all regular package files except itself.

## Frozen r9 local results

| Measure | Local recomputation |
|---|---:|
| Profiles (foundation / programme) | **221** (133 / 88) |
| Programme profiles immediately foundation-derived | **82** |
| ValueSets / CodeSystems | **213** / **51** |
| Questionnaires / QuestionnaireResponses / ConceptMaps | **19** / **17** / **7** |
| Programme Questionnaires / QuestionnaireResponses | **18** / **16** |
| Cross-guide edges, all generated JSON | **525** = 343 programme→foundation + 182 foundation→foundation |
| Text-supported profile associations | **168** of 199 (was 165 before the exact-id fix) |
| Forbidden cross-guide directions | **0** programme→programme; **0** foundation→programme |
| Conformance-only edges | **404** = 237 programme→foundation + 167 foundation→foundation |
| Guide dependency graph | **DAG** |
| Narrow foundation-use observations / foundation artefacts | **86** / **38** |
| ConceptMap entries | **199** |
| Text-supported profile associations / exact target IDs | **168** / **75** |
| Examples valid, portfolio | **369 / 384** |
| Examples valid, programme tier | **283 / 297** |
| Failing examples / parsed validation events | **15** / **27** |

## Important measurement definitions

### Cross-guide edges

The runner walks **all JSON strings**, including strings inside arrays, in every generated resource including `ImplementationGuide`. It strips canonical `|version` suffixes and recognizes an internally owned canonical only where a portfolio resource declares that `.url`.

The source identity is guide-qualified (`<guide>|<resource .url or ResourceType/id>`), preventing identically named resources in different guides from collapsing. `text.div` is skipped because it is generated narrative. The only ConceptMap exclusion is `group[*].element` and `group[*].target`; no other ConceptMap fields are excluded. `results/canonical_reference_edges.csv` retains all observed field paths per distinct source→target edge. The graph is checked explicitly in `results/guide_dependency_dag.json`.

### Narrow foundation use

This is deliberately not the broad cross-guide measure. It counts only portfolio-owned foundation canonicals referenced from programme resources at:

- `baseDefinition`
- `type.profile`
- `type.targetProfile`
- `meta.profile`
- `extension.url`
- `binding.valueSet`

ConceptMaps are excluded for this measure. `results/foundation_use_rows.csv` records every observed source field path; `foundation_use_observations.csv` collapses these to distinct `(foundation canonical, programme guide)` observations.

### ValueSet duplicate membership

The duplicate comparison evaluates only `ValueSet.compose.include` definitions that are explicit, non-versioned `system|code` sets. Definitions containing filters, imports, excludes, versions, missing systems, or no explicit codes are excluded rather than inferred or conflated with empty sets. The current frozen evidence has **187 evaluated explicit sets** and **26 excluded non-explicit sets**. `results/valueset_duplicates_explicit.csv` reproduces **one cross-guide duplicate group** (and two within-guide groups), but this restricted metric should not be described as a semantic ValueSet equivalence test.

### ConceptMap targets

`results/conceptmap_entries.csv` calls a target a **text-supported profile association** if its `code`, `display`, or `comment` mentions a known profile id/name longer than six characters; an exact target code equal to a known profile id is separately marked (including short ids). It exports matched profile IDs and reasons. This is an automated text heuristic, **not guaranteed semantic equivalence**; positive rows are ambiguity-flagged for author review. No destination is invented.

### Examples and validation events

Examples are listed by `ImplementationGuide.definition.resource` using R5 `isExample` plus legacy `exampleBoolean`/`exampleCanonical` flags. The publisher's separate **`Build Errors` row counts unresolved narrative links in the generated HTML**, not conformance errors, and is excluded from every count here: the portfolio carries 8,749 of them, 6,362 in `ig-lt-lifestyle`, whose conformance error count is nil. `qa.json` `errs` is the cross-check, and it agrees with the per-resource table in all eleven guides. A listed example must have a QA table entry; absent entries cause failure, rather than being counted as zero-error. The 17 QuestionnaireResponses all canonically match a current Questionnaire; recursive response `item.linkId` sets are subsets of the matched Questionnaires' current linkIds. This does **not** independently verify linkIds against original pre-migration source forms.

The raw QA parser absorbs continuation lines and exports all raw `ERROR:` records in `results/raw_qa_error_events.csv`; it selects the 27 per-resource nonzero validation events in `results/validation_error_events.csv`. Cause labels are joined from `author_supplied/validation_errors.csv` only after whitespace-normalized message matching. They are conspicuously labelled **AUTHOR-SUPPLIED**, including `snomed-edition`; this runner makes no independent SNOMED edition claim or terminology lookup.

`evidence/dgr1/output.txt` is checked for presence and its recorded failures. The probe covers **both** shapes dgr-1 produces in this snapshot: a multi-item left operand, which the engine rejects outright, and an empty one, which makes `in` and then `implies` return empty. Six of the eight flagged DiagnosticReports are the first case and two are the second. No fresh Publisher JAR execution is needed or claimed; `run.sh` takes the jar path as an argument and the manifest records its SHA-256.

## Provenance and hashes

`evidence/` and `audit_manifest.json` are unchanged copies of v1.0 inputs. The manifest's source hashes are recorded provenance. They are **not recomputed** because the original source checkouts are intentionally not part of this candidate package. The new `hashes.txt` hashes the candidate package inputs, scripts, tests, documentation, and generated outputs (excluding `hashes.txt` itself).

## Results files

| File | Purpose |
|---|---|
| `artefact_counts.csv` | Counts by guide and role |
| `profile_inheritance.csv` | One row per profile; immediate-base classification |
| `canonical_reference_edges*.csv` | All-resource and conformance-only cross-guide edge evidence with paths |
| `guide_dependency_dag.json` | Explicit DAG result and guide-level edges |
| `foundation_use_rows.csv` / `foundation_use_observations.csv` | Field-level narrow-use evidence and collapsed observations |
| `valueset_explicit_memberships.csv` / `valueset_duplicates_explicit.csv` | Explicit membership eligibility and duplicate groups |
| `questionnaire_response_matches.csv` / `questionnaire_response_linkids.csv` | Current canonical match and recursive linkId subset checks |
| `conceptmap_entries.csv` | Target heuristic, IDs, reasons, ambiguity flags |
| `validation_summary.csv`, `failing_examples.csv`, `validation_error_events.csv` | Current QA-derived validation results |
| `assertions.csv`, `summary.json`, `RECOMPUTATION_SUMMARY.md` | Dataset assertion and human-readable summaries |

## Before publication: remaining tasks

1. If claiming a fresh rebuild or warning-free SUSHI compilation, obtain source checkouts and complete rebuild logs at the manifest commits (with dependency/cache control). They are not needed to rerun the archived-output audit; do not represent this local recomputation as a fresh build.
2. Collect **SNOMED lookup records** (edition, request/response, date, authority) for every terminology attribution before asserting any SNOMED-edition cause.
3. Conduct **author review of every automated ConceptMap classification**, especially ambiguity-flagged text-supported associations; do not treat the heuristic as semantic equivalence.
4. If the paper must assert preservation against original source forms, collect the **original form/source evidence** and compare linkIds; the current result only checks QuestionnaireResponse against the current Questionnaire.
5. Review all 15 failing examples and 27 validation-event classifications with guide/terminology owners; AUTHOR-SUPPLIED labels are not independently proven here.
6. User must publish a reviewed release, add the public release URL/DOI, replace manuscript placeholder **`[AUDIT_RELEASE_URL]`**, and only then cite the package.
