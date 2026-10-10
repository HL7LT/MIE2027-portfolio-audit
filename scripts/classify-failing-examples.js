#!/usr/bin/env node
// For a round, split the examples that still carry errors into the ones blocked by
// something outside our control and the ones that are ordinary unfinished work.
//
// This is the number that decides whether "100% of examples validate" is reachable at
// all. An example blocked by a terminology gap or a core-invariant limitation cannot be
// cleared by more of the same effort; an example failing on a wrong display or a
// slicing defect can.
//
// Usage: node classify-failing-examples.js <round>
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const round = process.argv[2] || 'r4';

const GUIDES = ['ig-lt-eu', 'ig-lt-base', 'ig-lt-vitalsigns', 'ig-lt-lab', 'ig-lt-lifestyle',
  'ig-lt-cvd', 'ig-lt-breast', 'ig-lt-prostate', 'ig-lt-lung', 'ig-lt-cervical', 'ig-lt-colorectal'];

// The specific things established as having no available fix.
const BLOCKED = [
  { id: 'dgr-1-subsection', test: m => /Constraint failed: dgr-1:/.test(m),
    why: 'core FHIR invariant dgr-1 does not traverse Composition subsections' },
  { id: 'snomed-no-concept', test: m => /#(252076005|364372004|1286889002|416237000)\./.test(m),
    why: 'SNOMED CT has no concept for what the artefact means' },
  { id: 'icd10-block-precision', test: m => /icd-10#D06\./.test(m),
    why: 'ICD-10 D06 is a block; the "unspecified" subdivision is D06.9' },
  { id: 'upstream-publisher-check', test: m => /the owning committee must be stated|additional-binding.*latest version it can be used with/.test(m),
    why: 'publisher check the upstream HL7 artefacts fail too' },
];

let totalEx = 0, totalValid = 0;
const rows = [];

for (const guide of GUIDES) {
  const snap = path.join(ROOT, '_audit', 'snapshots', round, guide);
  const qa = path.join(snap, 'qa.txt');
  if (!fs.existsSync(qa)) continue;

  let ex;
  try {
    ex = JSON.parse(execFileSync(process.execPath,
      [path.join(__dirname, 'count-examples.js'), path.join(ROOT, guide), qa],
      { maxBuffer: 1 << 26 }).toString());
  } catch (e) { continue; }

  totalEx += ex.total;
  totalValid += ex.valid;
  if (!ex.failing.length) continue;

  // Every error message attributed to each failing example.
  const parsed = JSON.parse(execFileSync(process.execPath,
    [path.join(__dirname, 'parse-qa.js'), qa, guide], { maxBuffer: 1 << 28 }).toString());
  const byResource = new Map();
  for (const i of parsed.issues) {
    if (i.severity !== 'ERROR' || !i.resource) continue;
    if (!byResource.has(i.resource)) byResource.set(i.resource, []);
    byResource.get(i.resource).push(i.message);
  }

  for (const f of ex.failing) {
    const msgs = byResource.get(f.ref) || [];
    const hits = BLOCKED.filter(b => msgs.some(m => b.test(m)));
    const allBlocked = msgs.length > 0 && msgs.every(m => BLOCKED.some(b => b.test(m)));
    rows.push({
      guide, ref: f.ref, errs: f.errs,
      blocked: hits.map(h => h.id),
      verdict: allBlocked ? 'blocked' : (hits.length ? 'mixed' : 'tractable'),
    });
  }
}

const pct = (a, b) => b ? (100 * a / b).toFixed(1) : '-';
console.log('round ' + round);
console.log('examples: ' + totalValid + ' of ' + totalEx + ' valid (' + pct(totalValid, totalEx) + '%)');
console.log('examples still failing: ' + rows.length);
console.log();

for (const v of ['blocked', 'mixed', 'tractable']) {
  const list = rows.filter(r => r.verdict === v);
  const label = { blocked: 'BLOCKED — no fix available with current content',
    mixed: 'MIXED — has a blocked error and tractable ones',
    tractable: 'TRACTABLE — ordinary unfinished work' }[v];
  console.log('## ' + label + '  (' + list.length + ' example' + (list.length === 1 ? '' : 's') + ')');
  for (const r of list) {
    console.log('    ' + String(r.errs).padStart(3) + ' err  ' + r.guide.replace('ig-lt-', '').padEnd(12)
      + r.ref + (r.blocked.length ? '   [' + r.blocked.join(', ') + ']' : ''));
  }
  console.log();
}

const reachable = totalValid + rows.filter(r => r.verdict === 'tractable').length;
console.log('If every tractable example were fixed: ' + reachable + ' of ' + totalEx
  + ' (' + pct(reachable, totalEx) + '%)');
console.log('Examples that cannot reach valid without upstream or terminology change: '
  + rows.filter(r => r.verdict !== 'tractable').length);
