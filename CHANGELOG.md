# Changelog

What changed in the manuscript, and why.

## Corrected numerical results

| Figure | Was | Now |
|---|---|---|
| Examples valid, portfolio | 327 / 397 (82.4 %) | **369 / 384 (96.1 %)** |
| Examples valid, programme tier | 243 / 310 (78.4 %) | **283 / 297 (95.3 %)** |
| Code systems | 42 | **51** |
| Distinct cross-guide references | 283 | **212** |
| Foundation-use observations / artefacts | 69 / 30 | **86 / 38** |
| ConceptMaps / entries | 4 / 99 | **7 / 199** |
| ConceptMap profile targets / other | 76 / 23 | **165 / 34** |
| Programmes with ConceptMaps | 2 | **4** |
| Unresolved canonical URLs | 31, of which 3 internal | **0 internal** |
| IG Publisher version | 2.2.10 | **2.3.4** |

Unchanged and reconfirmed: 221 profiles, 133 foundation and 88 programme; 82 of 88 (93.2 %)
foundation-derived, 3 from HL7 Europe, 3 same-programme, 0 from FHIR core; 213 value sets with
one duplicate coded membership across guides; 18 programme Questionnaires and 16
QuestionnaireResponses; 14 ConceptMap entries in two guides relating form items to Vital Signs
profiles.

The example denominator fell from 397 to 384 because the migrated blood-pressure panels were
rebuilt in the shape the core `bp` profile requires: one Observation with systolic and
diastolic as components, replacing a panel plus two child Observations.

## Why the errors fell

819 errors at the start of the audit, 27 now. The work behind that is in the guide
repositories, not here; in outline:

- Three SNOMED codes that named something else entirely were replaced after checking each
  identifier against SNOMED CT International 2026-09-01. Three gaps with no pre-coordinated
  concept are now post-coordinated expressions rather than local codes.
- Several slicing discriminators pointed at a path carrying no assertion, so the validator
  could not evaluate the slicing at all. Each now points where the assertion is.
- Dependencies were pinned to released versions in place of continuous builds, and the
  continuous-build packages were moved out of the shared package cache. One measurement had
  been taken against a stale `#current` copy of a value set.
- The migrated blood-pressure examples were rebuilt to the core `bp` profile, which R5 applies
  by category and code whatever profile an instance declares.

## New references

Added: Corrêa Rampinelli VP, Dos Santos RA, Celuppi IC, et al. *Fast healthcare
interoperability resources (FHIR) implementation guide creation process: scoping review.*
Int J Med Inform. 2026;219:106548. doi:10.1016/j.ijmedinf.2026.106548. Verified against
PubMed (PMID 42322886). Cited as prior work on the guide development lifecycle, which the
portfolio-level question is distinguished from.

## Significance and novelty

The Introduction now frames the work as governance of semantic infrastructure shared across
programme-specific information systems, matching the MIE2027 track *Health Data Spaces,
Interoperability and Information Systems*. The Discussion states what the measures protect
against: divergence of common concepts, unsafe independent release, lost form provenance, and
an unverifiable specification pipeline.

The novelty claim is explicit and bounded: not a new FHIR mechanism, but a portfolio-audit
method and its application to eleven separately published guides. The related-work paragraph
distinguishes this from profile-proliferation studies, modular core datasets, single-model
translation, and lifecycle studies.

The Conclusion no longer implies clinical interoperability, and names what the audit does not
establish: secondary-use fitness, cross-border exchange, EHDS conformity.

## Removed claims

**"Two clean builds produced byte-identical audited outputs."** Removed. It was never
load-bearing, it is fragile now that builds reach a live terminology server, and it was not
re-verified for this snapshot. The reproducibility statement it is replaced by — pinned and
hashed inputs, recorded publisher version and SHA-256 — is both stronger and checkable.

**The promise of an archived audit release, in two places.** The Methods sentence promising
methods and expected outputs at an archive URL, and the Data availability placeholder. The
Data availability statement now names this package; the DOI and release URL remain to be
filled in.

## Remaining unresolved

1. **The archive DOI and release URL are placeholders.** The manuscript carries
   `[ARCHIVE DOI AND RELEASE URL REQUIRED BEFORE SUBMISSION]`.
2. **283 was not reconciled.** See the discrepancies section of `AUDIT_REPORT.md`. The figure
   reported is the one this package computes under a written rule.
3. **The manuscript has not been inspected as rendered.** Edits were made and verified at the
   XML and text level; no page proof was produced. Text grew roughly 13 %, and the target is
   five pages, so the page count and Table 1 need checking in Word.
4. **Eighteen errors depend on a live terminology service** and will change if it is updated.
5. **One post-coordinated expression is unconfirmed.** The lymph node size expression was
   composed during this work rather than by the terminology lead, and says "length of a lymph
   node, by ultrasound, in millimetres" without expressing *largest* or *altered*; those remain
   in the element definition.
