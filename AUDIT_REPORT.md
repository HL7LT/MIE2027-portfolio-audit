# Audit report

Snapshot **r9**: all eleven guides built from their merged `main` branches with IG Publisher
2.3.4. Counting rules are in `audit_method.md`; identity of the snapshot is in
`audit_manifest.json`.

## Results

### Artefacts

| | Foundation | Programme | Total |
|---|---|---|---|
| Profiles | 133 | 88 | **221** |
| Extensions | 14 | 2 | 16 |
| Value sets | 93 | 120 | **213** |
| Code systems | 9 | 42 | **51** |
| Questionnaires | 1 | 18 | 19 |
| QuestionnaireResponses | 1 | 16 | 17 |
| ConceptMaps | 0 | 7 | 7 |

### RQ1 — shared foundation and programme isolation

Of 88 programme profiles, **82 (93.2 %)** inherit directly from a foundation profile, three
from HL7 Europe profiles and three from another profile in the same programme guide. **None**
inherits directly from a FHIR R5 core resource.

**212** distinct cross-guide references: 131 programme → foundation, 81 foundation →
foundation, **0 programme → programme**, **0 foundation → programme**. The two zeros hold
under every variant of the rule tried, including counting only conformance resources (202
references) and including ConceptMap targets.

**86** foundation-use observations served by **38** foundation artefacts.

Across 213 value sets, **one** identical coded membership appears in two guides:
`ig-lt-lab:histological-grading` and `ig-lt-cervical:cervical-histological-grade`. Two further
pairs are identical within a single guide and are not counted, since the claim concerns
divergence between guides.

### RQ2 — legacy forms and traceability

All **18** programme forms are retained as Questionnaires; **16** have a QuestionnaireResponse
preserving the original linkIds. One further Questionnaire belongs to a foundation guide and
is outside that denominator.

**Seven** ConceptMaps across **four** programmes (CVD, prostate, lung, colorectal) carry **199**
entries. **165** targets name a published profile; the remaining **34** denote a resource class,
an element path, or an anticipated implementation destination.

Fourteen ConceptMap entries in two guides relate form items to Vital Signs profiles although
no programme profile references that guide structurally — a declared correspondence that a
structural-reference measure does not see.

### RQ3 — build and validation

All eleven guides compile from FHIR Shorthand with no SUSHI errors or warnings.

**369 of 384** examples validate (**96.1 %**) across the portfolio and **283 of 297**
(**95.3 %**) across the six programme guides. **Five of eleven guides validate with no errors
at all**: `ig-lt-eu`, `ig-lt-base`, `ig-lt-vitalsigns`, `ig-lt-lifestyle`, `ig-lt-colorectal`.
Every internal canonical reference resolves.

Twenty-seven errors remain. **None is unclassified**, and none originates in guide content:

| Cause | Errors | Why it is not guide content |
|---|---|---|
| `snomed-edition` | 18 | Concept active in SNOMED CT International 2026-09-01, absent from the 2025-02-01 edition the terminology server holds. Each was checked against both. |
| `r5-invariant-dgr-1` | 8 | The R5 expression hands a multi-item collection to the FHIRPath `in` operator; the publisher's own engine rejects it. HL7 corrected the expression in R6. No data change satisfies it under R5. |
| `icd-o-3-fragment` | 1 | The server holds ICD-O-3 as a fragment and says so; it cannot confirm a code present in the bound value set. |

## Claim-to-evidence table

| Manuscript claim | Value | Evidence |
|---|---|---|
| Guides in portfolio | 11 | `audit_manifest.json` |
| Profiles / value sets / code systems | 221 / 213 / 51 | `scripts/recompute-claims.js` |
| Foundation profiles | 133 (60.2 %) | `results/profile_inheritance.csv` |
| Programme profiles foundation-derived | 82 / 88 (93.2 %) | `results/profile_inheritance.csv` |
| Programme profiles from FHIR core | 0 | `results/profile_inheritance.csv` |
| Distinct cross-guide references | 212 | `results/canonical_reference_edges.csv` |
| Programme → programme references | 0 | `results/canonical_reference_edges.csv` |
| Foundation → programme references | 0 | `results/canonical_reference_edges.csv` |
| Foundation-use observations / artefacts | 86 / 38 | `scripts/recompute-claims.js` |
| Duplicate coded memberships across guides | 1 | `results/valueset_duplicates.csv` |
| Programme Questionnaires / responses | 18 / 16 | `results/questionnaires_and_responses.csv` |
| ConceptMaps / entries / profile targets | 7 / 199 / 165 | `results/conceptmap_entries.csv` |
| Examples valid, portfolio | 369 / 384 (96.1 %) | `results/validation_summary.csv` |
| Examples valid, programme tier | 283 / 297 (95.3 %) | `results/validation_summary.csv` |
| Guides with zero validation errors | 5 | `results/validation_summary.csv` |
| Remaining errors and causes | 27 = 18 + 8 + 1 | `results/validation_errors.csv` |
| dgr-1 is a specification defect | — | `evidence/dgr1/output.txt` |
| SUSHI clean | 0 errors, 0 warnings | build logs, per guide |

## Discrepancies from the manuscript as first drafted

Four figures changed. The first three are drift; the fourth could not be reconciled.

**Code systems, 42 → 51.** The original count was taken when `ig-lt-colorectal` could not
build, so its code systems were not counted. Four more were added during this work: one
defining the CVD questionnaire answer options, which were in use without a definition, and
three from splitting a polypectomy code system so that `Procedure.used` could be sliced.

**ConceptMaps, 4 → 7, and two programmes → four.** Lung and colorectal gained maps. The
manuscript's limitation that "ConceptMaps exist in only two programmes" was no longer true
and has been corrected.

**Foundation-use observations, 69 / 30 → 86 / 38.** Recomputed under the rule the manuscript
itself states.

**Cross-guide references, 283 → 212. This one does not reconcile.** Applying the stated rule
to the snapshot gives 212, decomposing as 131 programme → foundation and 81 foundation →
foundation. A note from the drafting process records the original as `283 = 202 + 81`. The
foundation → foundation half matches exactly; the programme → foundation half does not, and
131 is stable across every round measured (130 at the earliest). Neither the broad rule nor
the manuscript's own enumerated rule reproduces 202. The original computation could not be
recovered, so the figure reported is the one this package computes, under a rule written down
in `audit_method.md`.

## Limitations

The audit evaluates specifications, not production information systems. Structural
inheritance does not prove semantic agreement, and validation does not prove clinical
validity. Eleven guides under one governance arrangement are not independent replications.

**The result is not fully reproducible, by design.** Validation ran against the live
`tx.fhir.org`, and 18 of the 27 remaining errors exist only because of the SNOMED CT edition
it currently serves. A rerun after a server update will differ with no change to any guide.
The alternative — pinning a terminology server — would have validated against an edition
older than concepts the guides legitimately use. The edition in force is recorded, and the
affected errors are identifiable by their `cause` column.

Three terminology gaps are carried as post-coordinated SNOMED CT expressions rather than
pre-coordinated concepts, because no pre-coordinated concept exists: the percentage of Gleason
pattern 5, the condition of a lactiferous duct on ultrasound, and the size of a lymph node
measured in vivo. Each expression was validated against the edition the server holds. Requests
for pre-coordinated concepts are a separate matter and are not part of this audit.
