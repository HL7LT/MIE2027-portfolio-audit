# Counting rules

Each rule is stated so that someone can re-implement it and get the same number. Where a rule
contains a judgement call, the call is named and its cost reported.

## Scope

The portfolio is eleven guides: five foundation (`ig-lt-eu`, `ig-lt-base`,
`ig-lt-vitalsigns`, `ig-lt-lab`, `ig-lt-lifestyle`) and six programme (`ig-lt-cvd`,
`ig-lt-breast`, `ig-lt-prostate`, `ig-lt-lung`, `ig-lt-cervical`, `ig-lt-colorectal`).
`ig-lt-screening` and `ig-lt-espbi` exist in the same organisation and are **not** part of
the audit: `ig-lt-screening` is a second, older working copy of the `ig-lt-cvd` repository,
and `ig-lt-espbi` is a separate guide outside the screening portfolio.

Measurements are taken from built JSON resources, not from FHIR Shorthand source.

## Artefacts

A **profile** is a `StructureDefinition` with `derivation = constraint`, excluding those with
`type = Extension` and those with `kind = logical`. Extensions are counted separately; they
are not profiles for the purposes of the inheritance figures. Value sets and code systems are
counted as published, one per resource.

## Profile inheritance

A programme profile is **foundation-derived** when its immediate `baseDefinition` names a
canonical owned by a foundation guide. Only the immediate base is followed: a profile two
steps from the foundation is not counted as foundation-derived. The remaining programme
profiles are classified as inheriting from an HL7 Europe profile, from another profile in the
same programme guide, directly from a FHIR R5 core resource, or other.

Evidence: `results/profile_inheritance.csv`, one row per profile.

## Cross-guide references

A canonical is **owned** by the guide whose published resource declares it in `.url`. A URL
no guide in the portfolio declares is external and ignored.

A **cross-guide reference** is a distinct (source artefact, target canonical) pair whose
target is owned by a guide other than the source's. The source artefact is identified by its
own `.url` where it has one, and by `ResourceType/id` otherwise, since examples usually have
no canonical. Direction runs from the source's guide to the owner's.

A candidate reference is any JSON **string value** that begins with `http://` or `https://`,
found anywhere in the resource, with a trailing `|version` removed. Generated narrative is a
single string that does not itself begin with `http`, so links inside it never qualify — by
construction rather than by special-casing.

ConceptMap `group.element` and `group.target` are excluded. **This is the judgement call.** A
map recording that a form item corresponds to a profile states its payload, not a dependency
of the map on the guide owning that profile; counting it would make traceability work look
like coupling. In this snapshot the exclusion changes nothing, because ConceptMap targets are
local codes rather than canonicals, but the rule is stated because it would matter in a
portfolio whose maps name canonicals directly.

Evidence: `results/canonical_reference_edges.csv`, one row per pair.

## Foundation-use observations

A **foundation-use observation** is a distinct (foundation artefact, programme guide) pair in
which a built programme artefact references the foundation canonical through `baseDefinition`,
a type or target profile, `meta.profile`, an extension URL, or a terminology binding.
ConceptMap targets are excluded.

This is deliberately narrower than the cross-guide rule above: it asks which foundation
artefacts programme guides actually build on, not every canonical that appears anywhere.
The two measures answer different questions and are reported separately.

## Value set duplication

`ValueSet.compose` membership is canonicalised to the sorted set of `system|code` pairs,
discarding identity and presentation metadata. Two value sets are duplicates when those sets
are identical. Only duplication **across guides** is reported, since the claim concerns
divergence between guides; within-guide pairs are exported as well but flagged `cross_guide =
no` so the distinction is visible.

Evidence: `results/valueset_memberships.csv`, `results/valueset_duplicates.csv`.

## Forms and traceability

Every `Questionnaire` and `QuestionnaireResponse` is listed with its owning guide. One
Questionnaire belongs to a foundation guide and is excluded from the programme-form
denominator; the exported table shows the role so the exclusion can be checked.

ConceptMap entries are counted one row per `group.element.target`. A target is classified as
naming a published profile when its code resolves to a profile id in the portfolio; otherwise
it denotes a resource class, an element path, or an anticipated implementation destination,
and does not establish profile-level traceability.

Evidence: `results/questionnaires_and_responses.csv`, `results/conceptmap_entries.csv`.

## Validation

An example is **valid** when IG Publisher reports zero errors against it. Broken narrative
links are reported by the publisher separately from validation errors and are excluded from
both counts — they are a documentation-build concern, not a conformance one.

Every remaining error is classified by cause, and the classification is evidence-based rather
than asserted:

- `snomed-edition` — the concept was checked against both SNOMED CT International 2026-09-01
  and 2025-02-01. It is active in the former and absent from the latter, which is the edition
  `tx.fhir.org` serves.
- `r5-invariant-dgr-1` — the R5 expression passes a multi-item collection to the FHIRPath
  `in` operator. `evidence/dgr1/` contains a probe that evaluates the operator with the same
  engine, from the same publisher jar, and records the result; the engine raises
  `left operand to in can only have 1 value`. R6 rewrites the expression with `.all(...)`.
- `icd-o-3-fragment` — the terminology server reports the code system as a fragment and says
  so in its own message, so it cannot confirm a code that is present in the bound value set.

Evidence: `results/validation_summary.csv`, `results/validation_errors.csv` with one row per
error, and the unedited `qa.txt` and `qa.json` per guide under `evidence/r9/`.
