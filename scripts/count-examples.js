#!/usr/bin/env node
// Reproduce the paper's "examples valid" metric for one guide.
//
// An example is an ImplementationGuide.definition.resource entry flagged as one:
// R5 spells that isExample=true (+ optional profile[]); R4 spelled it
// exampleBoolean/exampleCanonical. An example is *valid* when the IG Publisher
// reported zero errors against it.
//
// Usage: node count-examples.js <ig-dir> <qa.txt>
'use strict';
const fs = require('fs');
const path = require('path');

const [, , igDir, qaPath] = process.argv;
if (!igDir || !qaPath) { console.error('usage: count-examples.js <ig-dir> <qa.txt>'); process.exit(2); }

// -- locate the generated ImplementationGuide ---------------------------------
const resDir = path.join(igDir, 'fsh-generated', 'resources');
const igFile = fs.readdirSync(resDir).find(f => /^ImplementationGuide-.*\.json$/.test(f));
if (!igFile) { console.error('no generated ImplementationGuide in ' + resDir); process.exit(2); }
const ig = JSON.parse(fs.readFileSync(path.join(resDir, igFile), 'utf8'));

const examples = [];
for (const r of (ig.definition && ig.definition.resource) || []) {
  const isExample = r.isExample === true
    || r.exampleBoolean === true
    || typeof r.exampleCanonical === 'string';
  if (!isExample) continue;
  const ref = (r.reference && r.reference.reference) || '';
  const profile = r.profile || (r.exampleCanonical ? [r.exampleCanonical] : null);
  examples.push({ ref, name: r.name || '', profile });
}

// -- per-resource error counts from qa.txt's summary table ---------------------
const counts = {};   // "Type/id" -> errs
for (const l of fs.readFileSync(qaPath, 'utf8').split(/\r?\n/)) {
  if (l.trim() === '</table>') break;
  const m = l.match(/^ (.+?) : (\d+) \/ (\d+) \/ (\d+)\s*$/);
  if (!m) continue;
  // "...\fsh-generated\resources\Observation-example-lipidogram" -> Observation/example-lipidogram
  const base = m[1].replace(/\\/g, '/').split('/').pop();
  const dash = base.indexOf('-');
  if (dash > 0) counts[base.slice(0, dash) + '/' + base.slice(dash + 1)] = +m[2];
  counts[base] = +m[2];
}

let valid = 0;
const failing = [];
for (const e of examples) {
  const errs = counts[e.ref] !== undefined ? counts[e.ref] : 0;
  if (errs === 0) valid++; else failing.push({ ref: e.ref, errs });
}

console.log(JSON.stringify({
  guide: path.basename(igDir),
  package: ig.id,
  total: examples.length,
  valid,
  invalid: examples.length - valid,
  pct: examples.length ? +(100 * valid / examples.length).toFixed(1) : null,
  failing: failing.sort((a, b) => b.errs - a.errs),
}, null, 1));
