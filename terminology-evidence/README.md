# Terminology lookups

Version-pinned lookups substantiating the `snomed-edition` cause label, performed on
11 October 2026 by an independent review of this package.

`lookup_summary.csv` records, per concept and edition: whether the concept was present,
which service answered, and when. Concept displays are deliberately **not** included
here; the five concepts are already published in the implementation guides themselves.

Two sources were used:

- `tx.fhir.org/r4/CodeSystem/$lookup`, version-pinned, for the editions that service
  holds. A positive control (73211009) confirmed the endpoint and parameters resolve.
- The SNOMED International browser, for the current International Edition, which
  `tx.fhir.org` does not serve.

All five concepts are active in International Edition 2026-10-01 and absent from the
2025-02-01 edition the validation ran against. That is the whole of the `snomed-edition`
claim.

**Licence.** SNOMED CT content is licensed, and the browser sub-licence restricts
copying identifiers into record systems and redistributing content. This summary is kept
to presence/absence facts for codes the guides already publish. Review the terms that
apply to you before redistributing anything further.
