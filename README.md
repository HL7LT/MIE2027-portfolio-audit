# MIE2027 FHIR portfolio audit

Evidence for the quantitative claims in *Auditing a Shared FHIR R5 Foundation Across Six
National Screening Programmes: Reuse, Isolation and Legacy-Form Traceability*.

The eleven implementation guides themselves are public and are not copied here. What this
package adds is the method: the scripts that computed each number, the raw output they read,
and a table tying every figure in the manuscript to the file it came from.

## What is measured

One frozen state, called **r9** throughout: all eleven guides built from their merged `main`
branches with IG Publisher 2.3.4. `audit_manifest.json` records, per guide, the repository,
package id, declared version, commit SHA, SHA-256 of the build inputs, declared dependency
versions and build status. Earlier rounds are not included — the manuscript reports one
snapshot, and mixing cohorts is the thing this audit exists to avoid.

## Reproducing the numbers without rebuilding

A full rebuild takes hours. Every figure can be recomputed from the output already in
`evidence/r9/`, which is what the scripts read:

```bash
node scripts/recompute-claims.js            # artefact counts, inheritance, ConceptMaps
node scripts/cross-guide-references.js --round r9
node scripts/classify-failing-examples.js r9
node scripts/report.js r9
```

`scripts/` expects to run from a checkout laid out as `<root>/_audit/snapshots/r9/<guide>/`;
point them at `evidence/r9` or copy that tree into place. Node 18 or later, no dependencies.

`results/` holds the same figures already exported as CSV, one row per underlying
observation rather than per summary count, so a claim can be checked without running
anything.

## Reproducing the build

```bash
# per guide, from its own checkout at the commit in audit_manifest.json
sushi .
java -Xmx8g -jar publisher-2.3.4.jar -ig .
```

Pin every dependency to the version in `audit_manifest.json`; the guides declare them, but a
`#current` or `#dev` copy of the same package sitting in `~/.fhir/packages` will be consulted
when a canonical is resolved, and its content differs. That is not hypothetical — it produced
a wrong value-set membership result during this audit, and the fix was to move every
continuous-build package out of the cache.

## What cannot be reproduced exactly

Validation ran against the live `https://tx.fhir.org`. **Eighteen of the twenty-seven
remaining errors exist only because that server serves SNOMED CT International 2025-02-01**;
each of those concepts is active in the 2026-09-01 edition. If the server is updated, a rerun
returns fewer errors with no change to any guide.

This is a deliberate trade. Pinning a terminology server would have frozen the result at the
cost of validating against a SNOMED edition older than the concepts the guides legitimately
use. The edition in force is recorded in `audit_manifest.json` so a reader can tell which
numbers depend on it: they are the rows in `results/validation_errors.csv` with cause
`snomed-edition`.

## Layout

```
audit_manifest.json   snapshot identity: commits, hashes, versions, dependencies
audit_method.md       counting rules, stated precisely enough to re-implement
AUDIT_REPORT.md       results, claim-to-evidence table, discrepancies, limitations
CHANGELOG.md          what changed in the manuscript and why
hashes.txt            SHA-256 of every file in this package
scripts/              analysis scripts
evidence/r9/          per guide: qa.json, qa.txt, status.txt, commit.txt, built resources
evidence/dgr1/        reproducible probe behind the dgr-1 attribution
results/              exported tables, one row per observation
```
