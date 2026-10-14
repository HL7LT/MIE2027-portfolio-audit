# Local recomputation summary

This report is computed from frozen local r9 evidence only. It performs **no fresh guide build**, no terminology lookup, and no SNOMED verification.

## Assertions

| Assertion | Expected | Actual | Status |
|---|---:|---:|---|
| profiles | 221 | 221 | PASS |
| profiles_foundation | 133 | 133 | PASS |
| profiles_programme | 88 | 88 | PASS |
| valuesets | 213 | 213 | PASS |
| codesystems | 51 | 51 | PASS |
| questionnaires | 19 | 19 | PASS |
| questionnaire_responses | 17 | 17 | PASS |
| conceptmaps | 7 | 7 | PASS |
| foundation_derived | 82 | 82 | PASS |
| all_edges | 525 | 525 | PASS |
| all_programme_foundation | 343 | 343 | PASS |
| all_foundation_foundation | 182 | 182 | PASS |
| conformance_edges | 404 | 404 | PASS |
| conformance_programme_foundation | 237 | 237 | PASS |
| conformance_foundation_foundation | 167 | 167 | PASS |
| foundation_use_pairs | 86 | 86 | PASS |
| foundation_use_artefacts | 38 | 38 | PASS |
| programme_questionnaires | 18 | 18 | PASS |
| programme_questionnaire_responses | 16 | 16 | PASS |
| conceptmap_entries | 199 | 199 | PASS |
| conceptmap_text_supported | 168 | 168 | PASS |
| conceptmap_exact_id | 75 | 75 | PASS |
| portfolio_examples_valid | 369 | 369 | PASS |
| portfolio_examples_total | 384 | 384 | PASS |
| programme_examples_valid | 283 | 283 | PASS |
| programme_examples_total | 297 | 297 | PASS |
| failing_examples | 15 | 15 | PASS |
| validation_events | 27 | 27 | PASS |
| cross_guide_valueset_duplicate_groups | 1 | 1 | PASS |
| guide_dependency_graph_is_dag | True | True | PASS |

## Key local results

- Profiles: **221** (133 foundation; 88 programme); 82 programme profiles immediately foundation-derived.
- Cross-guide edges: **525** = 343 programme→foundation + 182 foundation→foundation; forbidden directions programme→programme and foundation→programme are **0**. Conformance-only: **404** = 237 + 167. Guide graph DAG: **True**.
- Narrow foundation-use observations: **86** pairs served by **38** foundation artefacts.
- Examples valid: **369/384** portfolio; **283/297** programme; failing examples: **15**; parsed validation events: **27**.
- ConceptMaps: **7** maps / **199** entries; **168** text-supported profile associations, including **75** exact target IDs. These associations are not guaranteed semantic equivalence and positives are ambiguity-flagged.
- Explicit ValueSet system|code sets: 187 evaluated; 26 non-explicit sets excluded; cross-guide duplicate groups: 1.

## Classification caveat

`validation_error_events.csv` joins cause labels from the supplied historical table after whitespace-normalized message matching. The labels are **AUTHOR-SUPPLIED** and are not independent proof of a SNOMED edition or of any external condition.
