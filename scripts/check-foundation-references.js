#!/usr/bin/env node
// Check that every reference a guide makes into a foundation package still resolves
// against the pinned version of that package.
//
// Pinning exposed this: ig-lt-lab was on lt.hl7.fhir.base 0.2.0 and referred to
// profiles by the names that version used — LTBaseObservation, LTBasePatient. Those
// were renamed to ObservationLt and PatientLt by 0.4.0, so moving the pin to 0.4.0
// broke every profile in the guide with "Parent LTBaseObservation not found". Ids can
// drift the same way (lt-patient -> patient-lt), and a canonical that no longer
// resolves is silent until something tries to use it.
//
// Reports, for each guide: FSH names used as Parent/only/from that no foundation
// package defines, and hl7.lt canonicals whose id no foundation package has.
//
// Usage: node check-foundation-references.js <ig-dir> [<ig-dir> ...]
'use strict';
const fs = require('fs');
const path = require('path');

const CACHE = path.join(process.env.HOME || process.env.USERPROFILE, '.fhir', 'packages');
const ROOT = path.resolve(__dirname, '..');

// Everything the pinned foundation packages define, by name and by canonical.
const names = new Map();      // FSH name -> package
const canonicals = new Map(); // url -> package
const FOUNDATION_PKGS = fs.existsSync(CACHE)
  ? fs.readdirSync(CACHE).filter(d => /^(lt\.hl7\.fhir\.(eu|base|vitalsigns|lab|lifestyle)|hl7\.fhir\.eu\.)/.test(d))
  : [];

for (const pkg of FOUNDATION_PKGS) {
  const d = path.join(CACHE, pkg, 'package');
  if (!fs.existsSync(d)) continue;
  for (const f of fs.readdirSync(d)) {
    if (!f.endsWith('.json') || f.startsWith('.')) continue;
    let j;
    try { j = JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')); } catch (e) { continue; }
    if (j.name && !names.has(j.name)) names.set(j.name, pkg);
    if (j.url && !canonicals.has(j.url)) canonicals.set(j.url, pkg);
  }
}

// Every resource and datatype name R5 core defines, read from the core package so the
// list cannot drift out of date.
const R5_TYPES = new Set();
{
  const core = path.join(CACHE, 'hl7.fhir.r5.core#5.0.0', 'package');
  if (fs.existsSync(core)) {
    for (const f of fs.readdirSync(core)) {
      if (!/^StructureDefinition-/.test(f)) continue;
      let j;
      try { j = JSON.parse(fs.readFileSync(path.join(core, f), 'utf8')); } catch (e) { continue; }
      // Every name core defines that FSH will accept as a Parent — including the
      // named datatype profiles such as SimpleQuantity and MoneyQuantity, which are
      // derivation=constraint and were wrongly reported as unresolved.
      if (['resource', 'complex-type', 'primitive-type'].includes(j.kind) && j.name) {
        R5_TYPES.add(j.name);
      }
    }
  }
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.fsh')) out.push(p);
  }
  return out;
}

let problems = 0;
for (const igDir of process.argv.slice(2)) {
  const fshDir = path.join(ROOT, path.basename(igDir), 'input', 'fsh');
  if (!fs.existsSync(fshDir)) continue;
  const guide = path.basename(igDir);

  // Names this guide defines itself never need to come from a dependency.
  const own = new Set();
  const files = walk(fshDir);
  for (const f of files) {
    for (const m of fs.readFileSync(f, 'utf8')
      .matchAll(/^(?:Profile|Extension|ValueSet|CodeSystem|Instance|Logical|Resource):\s*(\S+)/gm)) own.add(m[1]);
  }
  const aliases = new Set();
  for (const f of files) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/^Alias:\s*(\$\S+)/gm)) aliases.add(m[1]);
  }

  const badNames = new Map(), badUrls = new Map();
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    const rel = path.relative(ROOT, f).replace(/\\/g, '/');

    // Parent: X   and   only Reference(X or Y)   and   from X
    for (const m of text.matchAll(/^Parent:\s*(\S+)\s*$/gm)) {
      const n = m[1];
      if (n.startsWith('$') || n.includes('/') || own.has(n) || names.has(n)) continue;
      // A bare FHIR resource or datatype is fine. This must be checked against the
      // real R5 type list, not a shape like /^[A-Z][A-Za-z]*$/ — "LTBaseObservation"
      // matches that pattern and was silently skipped, which is exactly the reference
      // that broke ig-lt-lab.
      if (R5_TYPES.has(n)) continue;
      if (!badNames.has(n)) badNames.set(n, []);
      badNames.get(n).push(rel);
    }

    // Canonicals into a *sibling* guide's namespace. A guide's own canonicals are
    // defined by the guide itself and are not expected in a dependency package.
    // The id must not swallow a sentence-ending period: these canonicals appear inside
    // prose descriptions too, and "…/encounter-lt." is not a different canonical.
    for (const m of text.matchAll(/https:\/\/hl7\.lt\/fhir\/(base|vitalsigns|lab|lifestyle|eu)\/(StructureDefinition|ValueSet|CodeSystem)\/[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*/g)) {
      const u = m[0];
      const slug = m[1];
      if (guide === 'ig-lt-' + slug) continue;
      if (canonicals.has(u)) continue;
      if (!badUrls.has(u)) badUrls.set(u, []);
      badUrls.get(u).push(rel);
    }
  }

  if (!badNames.size && !badUrls.size) { console.log('  ok: ' + guide); continue; }
  console.log('--- ' + guide);
  for (const [n, where] of badNames) {
    problems++;
    // suggest by shuffling the LT naming convention
    const alt = [...names.keys()].find(k =>
      k.toLowerCase().replace(/[^a-z]/g, '') ===
      n.toLowerCase().replace(/^ltbase/, '').replace(/[^a-z]/g, '') + 'lt');
    console.log('    name not defined by any pinned foundation package: ' + n
      + (alt ? '   (did you mean ' + alt + '?)' : ''));
    console.log('        ' + [...new Set(where)].slice(0, 3).join(', '));
  }
  for (const [u, where] of badUrls) {
    problems++;
    console.log('    canonical not in any pinned foundation package: ' + u);
    console.log('        ' + [...new Set(where)].slice(0, 3).join(', '));
  }
}

console.log();
console.log(problems ? problems + ' unresolved foundation reference(s)' : 'all foundation references resolve');
process.exit(problems ? 1 : 0);
