#!/usr/bin/env node
// Parse an IG Publisher qa.txt into structured, classified issue records.
//
// Usage: node parse-qa.js <qa.txt> <guide-id> > issues.json
//
// qa.txt layout:
//   <header>
//   <table of "<path> : errs / warns / info">
//   </table>
//   == <resource or n/a> ==
//   ERROR: <location>: <message>
'use strict';
const fs = require('fs');

const [, , qaPath, guide] = process.argv;
if (!qaPath || !guide) { console.error('usage: parse-qa.js <qa.txt> <guide>'); process.exit(2); }

const lines = fs.readFileSync(qaPath, 'utf8').split(/\r?\n/);

// -- header -------------------------------------------------------------------
const header = {};
for (const l of lines.slice(0, 8)) {
  let m;
  if ((m = l.match(/^err = (\d+), warn = (\d+), info = (\d+)/))) {
    header.errs = +m[1]; header.warnings = +m[2]; header.info = +m[3];
  } else if ((m = l.match(/^IG Publisher Version:\s*(\S+)/))) {
    header.publisher = m[1];
  } else if ((m = l.match(/^Generated (.+?)\. FHIR version (\S+) for (\S+) \(canonical = (\S+)\)/))) {
    header.generated = m[1]; header.fhirVersion = m[2];
    header.packageVersion = m[3]; header.canonical = m[4];
  }
}

// -- per-resource counts from the summary table -------------------------------
const perResource = {};
for (const l of lines) {
  if (l.trim() === '</table>') break;
  const m = l.match(/^ (.+?) : (\d+) \/ (\d+) \/ (\d+)\s*$/);
  if (!m) continue;
  const key = m[1].replace(/\\/g, '/')
    .replace(/^.*\/fsh-generated\/resources\//, '')
    .replace(/^.*\/input\//, '');
  perResource[key] = { errs: +m[2], warnings: +m[3], info: +m[4] };
}

// -- classification rules, first match wins -----------------------------------
// OURS = a canonical inside a namespace this portfolio owns.
const OURS = /https?:\/\/hl7\.lt\/fhir\//;
// Terminology this portfolio publishes itself, on the Lithuanian terminology server.
const OURS_TX = /https?:\/\/(tx|terminology)\.hl7\.lt\/fhir\//;
const EXTERNAL_NS = /https?:\/\/(hl7\.org\/fhir\/(uv|us)\/|hl7\.eu\/fhir\/|build\.fhir\.org\/|fhir\.org\/)/;

const RULES = [
  // build / configuration
  { id: 'config-suppressed-file', cause: 'ig-config', fixable: true,
    test: m => /Sup+ressed messages file not found/i.test(m) },
  { id: 'config-duplicate-title', cause: 'ig-config', fixable: true,
    test: m => /multiple resources with the same title/i.test(m) },
  // Narrative link integrity. Modern publishers count these under their own
  // "Broken Links" tally rather than under errs, so keep them in a class of
  // their own instead of mixing them into instance validation.
  { id: 'broken-narrative-link', cause: 'link-integrity', fixable: true,
    test: m => /at Line \d+, column \d+/.test(m) && /cannot be resolved/.test(m) },
  { id: 'fhir-version-mismatch', cause: 'dependency-hygiene', fixable: true,
    test: m => /This IG is for FHIR version .* while the package .* is for FHIR version/.test(m) },
  { id: 'dependson-uri', cause: 'dependency-hygiene', fixable: true,
    test: m => /ImplementationGuide\.dependsOn|The URL should refer directly to the ImplementationGuide resource|is inconsistent with the stated packageId/.test(m) },
  { id: 'url-mismatch-build', cause: 'vendored-external-copy', fixable: true,
    test: m => /: URL Mismatch /.test(m) },
  { id: 'hl7-owning-committee', cause: 'publisher-tooling', fixable: true,
    test: m => /the owning committee must be stated/.test(m) },
  { id: 'shareable-profile', cause: 'ig-config', fixable: true,
    test: m => /SHALL conform to the Shareable\w+ profile/.test(m) },
  { id: 'additional-binding-version', cause: 'publisher-tooling', fixable: false,
    test: m => /additional-binding.*specifies that the latest version it can be used with/.test(m) },
  { id: 'config-canonical-mismatch', cause: 'vendored-external-copy', fixable: true,
    test: m => /the canonical URL \(.*\) does not match the URL \(/.test(m) },

  // unresolved references
  { id: 'unresolved-internal-canonical', cause: 'internal-unresolved', fixable: true,
    test: m => /A definition could not be found for|could not be resolved|Unable to find/i.test(m) && OURS.test(m) },
  { id: 'unresolved-external-canonical', cause: 'external-unpublished', fixable: false,
    test: m => /A definition could not be found for|could not be resolved/i.test(m) && EXTERNAL_NS.test(m) },
  { id: 'unresolved-local-instance', cause: 'internal-unresolved', fixable: true,
    test: m => /Unable to resolve resource with reference/.test(m) },

  // Terminology, split by who is at fault rather than by who owns the code system.
  //
  // A display or a code that this portfolio typed incorrectly is this portfolio's
  // defect, whether the system is SNOMED CT or one of our own tx.hl7.lt code
  // systems. Filing those as "external" would be exactly the selective framing this
  // audit exists to remove. Only an unresolvable system, an unexpandable value set
  // or an unreachable server is genuinely outside our control.
  { id: 'terminology-display-wrong-own-cs', cause: 'terminology-ours', fixable: true,
    test: m => /Wrong Display Name|is not a valid display|valid display is one of|no longer considered a correct display/i.test(m)
      && OURS_TX.test(m) },
  { id: 'terminology-display-wrong-external-cs', cause: 'terminology-ours', fixable: true,
    test: m => /Wrong Display Name|is not a valid display|valid display is one of|no longer considered a correct display/i.test(m) },
  { id: 'terminology-code-invalid', cause: 'terminology-ours', fixable: true,
    test: m => /Unknown [Cc]ode|not a valid code|is not in the value set|None of the codings provided are in the value set|No valid coding was found/.test(m) },
  { id: 'terminology-coding-names-valueset', cause: 'terminology-ours', fixable: true,
    test: m => /The Coding references a value set, not a code system/.test(m) },
  { id: 'terminology-server-unavailable', cause: 'terminology-external', fixable: false,
    test: m => /tx\.fhir\.org|Terminology[- ]?[Ss]erver|cannot be validated because|Unable to connect to terminology/i.test(m) },
  { id: 'terminology-system-unresolvable', cause: 'terminology-external', fixable: false,
    test: m => /A definition for CodeSystem '.*' could not be found|Unable to expand ValueSet|ValueSet '.*' not found/i.test(m) },
  { id: 'terminology-valueset-not-expandable', cause: 'terminology-external', fixable: false,
    test: m => /the value set cannot be expanded/.test(m) },

  // publisher / tooling noise, mostly on snapshots of external artefacts
  { id: 'obligation-extension', cause: 'publisher-tooling', fixable: false,
    test: m => /obligation/i.test(m) && /(allows for the types \[\] but found|max allowed = 0, but found)/.test(m) },
  { id: 'ext-1-constraint', cause: 'publisher-tooling', fixable: false,
    test: m => /Constraint failed: ext-1:/.test(m) },

  // genuine modelling errors
  { id: 'slice-ambiguous', cause: 'semantic-artefact', fixable: true,
    test: m => /matches more than one slice/.test(m) },
  { id: 'slice-unevaluable', cause: 'semantic-artefact', fixable: true,
    test: m => /Slicing cannot be evaluated|does not have fixed value, binding or existence assertions/.test(m) },
  { id: 'questionnaireresponse-incomplete', cause: 'semantic-artefact', fixable: true,
    test: m => /No response answer found for required item/.test(m) },
  { id: 'vitalsigns-magic-code', cause: 'semantic-artefact', fixable: true,
    test: m => /magic LOINC code .* required, but not found/.test(m) },
  { id: 'conceptmap-scope-type', cause: 'semantic-artefact', fixable: true,
    test: m => /Reference must be to a \w+, but found a \w+ instead/.test(m) },
  { id: 'slice-missing', cause: 'semantic-artefact', fixable: true,
    test: m => /a matching slice is required, but not found/.test(m) },
  { id: 'cardinality', cause: 'semantic-artefact', fixable: true,
    test: m => /max allowed = \d+, but found \d+|minimum required = \d+, but only found/.test(m) },
  { id: 'wrong-target-type', cause: 'semantic-artefact', fixable: true,
    test: m => /Invalid Resource target type|Unable to find a profile match for .* \(by type\)/.test(m) },
  { id: 'invariant-failed', cause: 'semantic-artefact', fixable: true,
    test: m => /Constraint failed: [a-zA-Z0-9-]+:/.test(m) },
  { id: 'type-mismatch', cause: 'semantic-artefact', fixable: true,
    test: m => /allows for the types \[.*\] but found type|is not one of the allowed types/.test(m) },
];

function classify(message) {
  for (const r of RULES) { if (r.test(message)) return r; }
  return { id: 'unclassified', cause: 'unclassified', fixable: null };
}

// -- issue records ------------------------------------------------------------
const issues = [];
let section = null, inTable = true;
for (const raw of lines) {
  const l = raw.replace(/\s+$/, '');
  if (inTable) { if (l.trim() === '</table>') inTable = false; continue; }
  let m;
  if ((m = l.match(/^== (.*) ==$/))) { section = m[1].trim(); continue; }
  if (!(m = l.match(/^(ERROR|WARNING|INFORMATION|FATAL):\s*(.*)$/))) continue;
  const severity = m[1], body = m[2];
  // Instance validation lines start with "<Type>/<id>: "; build-level lines do not.
  let resource = section === 'n/a' ? null : section;
  let rest = body;
  const mm = body.match(/^([A-Z][A-Za-z]+\/[A-Za-z0-9._|-]+):\s*(.*)$/);
  if (mm) { resource = mm[1]; rest = mm[2]; }
  const rule = classify(rest);
  issues.push({ guide, severity, section, resource, message: rest, rule: rule.id, cause: rule.cause, fixable: rule.fixable });
}

process.stdout.write(JSON.stringify({ guide, header, perResource, issues }, null, 1));
