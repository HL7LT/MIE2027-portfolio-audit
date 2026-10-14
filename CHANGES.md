# Candidate v1.2 changes

Prepared 11 October 2026 by an independent review of candidate v1.1. Every change below was
verified: the runner re-runs clean, all 30 assertions pass, and `hashes.txt` verifies.

## Corrected in this candidate

- **ConceptMap classification now honours the exact-profile-id flag it already computed.**
  `exact_id` was calculated and then ignored, so three targets whose code *is* exactly a
  profile id (`bmi`, the Vital Signs BMI profile) were filed as unassociated while
  simultaneously flagged `exact_profile_id_target=yes`. The split becomes **168 / 31**, which
  matches an independent review of all 199 rows.
- **`snomed-edition` explanations name the edition actually verified.** All 18 rows said
  "concept active in SNOMED CT International 2026-09-01"; the release confirmed on
  11 October 2026 is **2026-10-01**, where all five concepts are active. The file as supplied
  is kept beside it as `author_supplied/validation_errors.v1.1-as-supplied.csv`.
- **`hashes.txt` and the JSON outputs are written with LF**, and `summary.json` records a
  POSIX input path. Previously a rerun on Windows changed every generated file's hash and the
  integrity check appeared to fail when nothing was wrong.
- **`hashes.txt` skips `__pycache__`.** Running the test suite created interpreter caches that
  were then hashed, so a correct package failed its own integrity check after `unittest`.
- **`evidence/dgr1/run.sh` is runnable.** It pointed at `../tools/publisher-2.3.4.jar`, which
  this package does not contain. It now takes the jar path as an argument (or `PUBLISHER_JAR`)
  and prints the SHA-256 the manifest records.
- **README states the broken-narrative-link exclusion.** The publisher's `Build Errors` row
  counts unresolved links in generated HTML, not conformance errors: 8,749 across the
  portfolio, 6,362 of them in `ig-lt-lifestyle`, whose conformance error count is nil.
  `qa.json` `errs` is the cross-check and agrees in all eleven guides.
- **README records the dgr-1 split.** Six of the eight flagged DiagnosticReports give the `in`
  operator a multi-item left operand; two give it an empty one. The archived probe
  demonstrates both; only the prose treated all eight as one case.
- **`terminology-evidence/` added**: presence/absence per concept and edition, with the
  licence position stated.

## Verified in this candidate

- 998 inherited files unchanged; `sha256sum -c hashes.txt` passes on 1002 entries.
- Two consecutive runs, with the test suite in between, produce byte-identical outputs.
- The dgr-1 probe re-run with the jar whose SHA-256 matches the manifest reproduces
  `evidence/dgr1/output.txt` byte for byte.
- Every counting rule re-implemented independently from the stated rules reproduces every
  figure: 221/133/88, 213, 51, 19/17/7, 82, 525 = 343 + 182, 404 = 237 + 167, both forbidden
  directions zero, acyclic, 86/38, 199, 18/16, 369/384, 283/297, 15 failing examples,
  27 events split 18 on examples and 9 on conformance artefacts.

## Still true of this candidate

Everything under "Unresolved / must not be overstated" in the v1.1 notes below still applies,
with one change: item 3's caution about SNOMED lookups is now partly discharged — the five
concepts were verified, and the evidence is in `terminology-evidence/`. The cause labels
remain author-supplied, and the runner still performs no terminology lookup of its own.

---

# Candidate v1.1 changes

## Fixed in the local audit computation

- Replaced the historical multi-script JavaScript workflow with one **dependency-free Python 3** runner: `scripts/recompute_snapshot.py`.
- Removed historical JavaScript from the candidate's active scripts. v1.0 remains provenance only at `/home/ubuntu/work/mie2027-v8-review/audit-v1.0`.
- Corrected profile counting: only `StructureDefinition` resources with `derivation=constraint`, excluding `type=Extension` and `kind=logical`, are profiles.
- Corrected cross-guide scanning to walk all JSON strings, including array strings and generated `ImplementationGuide` resources; canonical versions are stripped; source identities are guide-qualified; `text.div` is omitted; only ConceptMap `group.element`/`group.target` payloads are excluded.
- Exported cross-guide per-edge JSON field paths, all-resource and conformance-only outputs, direction counts, and an explicit DAG check.
- Corrected the foundation-use metric to its narrow declared fields only: `baseDefinition`, `type.profile`, `type.targetProfile`, `meta.profile`, `extension.url`, and `binding.valueSet`; exported per-use field rows.
- Corrected example counting to use `ImplementationGuide.definition.resource` example flags and made missing per-resource QA entries fatal instead of defaulting them to zero errors.
- Added raw multiline `ERROR:` parsing, validation-event export, QA JSON count reconciliation, and whitespace-normalized joining to an **AUTHOR-SUPPLIED** classification table.
- Added failing-example export and a local check for existing dgr evidence; no fresh JAR run is asserted.
- Added ValueSet eligibility reporting that compares only explicit, unversioned `system|code` include sets and excludes filters/imports/excludes/versioned/non-explicit definitions from the denominator.
- Added QuestionnaireResponse canonical matching and recursive current linkId subset checks.
- Reframed ConceptMap matching as **text-supported profile association**, export of matched IDs/reasons, exact target-ID count, and ambiguity flags; no semantic equivalence or destination is invented.
- Added deterministic package output hashes (`hashes.txt`, excluding itself), assertion table, local summary, and standard-library unit tests.

## Confirmed frozen-r9 results

- **525** all-resource cross-guide edges = 343 programme→foundation + 182 foundation→foundation; forbidden directions are zero.
- **404** conformance-only edges = 237 programme→foundation + 167 foundation→foundation; guide graph is a DAG.
- **86 / 38** narrow foundation-use observations / foundation artefacts.
- **369 / 384** portfolio and **283 / 297** programme examples valid; **15** failing examples; **27** validation events.
- **199** ConceptMap entries; **165** text-supported associations; **75** exact target IDs.

## Unresolved / must not be overstated

1. No fresh source build was performed. Obtain source checkouts, dependency/cache records, and new build logs before making fresh-build claims.
2. Manifest source hashes are preserved as provenance, but cannot be recomputed without the original checkouts.
3. The 27 causes are author-supplied classifications; no SNOMED lookup or edition status was independently verified. Archive authoritative lookup records before asserting such causes.
4. Automated ConceptMap text associations require author review and do not prove semantic equivalence.
5. Current QuestionnaireResponse linkIds are subsets of current Questionnaires; original pre-migration form linkIds were not independently examined.
6. The package is local and unpublished. The user must publish a reviewed release and replace manuscript `[AUDIT_RELEASE_URL]` before submission.
