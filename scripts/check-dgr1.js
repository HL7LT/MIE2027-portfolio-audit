#!/usr/bin/env node
// Work out, for every DiagnosticReport that fails dgr-1, whether the data is actually
// wrong or whether the invariant cannot see correct data.
//
// dgr-1 requires every Observation referenced from the report's Composition to also
// appear in DiagnosticReport.result, or in the hasMember of something in result. Two
// very different situations produce the same error:
//
//   * an Observation genuinely missing from result — a real defect, fixable here;
//   * the entries sitting in a Composition *subsection*, which the invariant's
//     expression (composition.resolve().section.entry) does not descend into — not
//     fixable without reshaping the document or changing the invariant.
//
// Usage: node check-dgr1.js <round>
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const round = process.argv[2] || 'r4';
const GUIDES = ['ig-lt-lab', 'ig-lt-cvd', 'ig-lt-breast', 'ig-lt-prostate', 'ig-lt-lung',
  'ig-lt-cervical', 'ig-lt-colorectal'];

for (const guide of GUIDES) {
  const dir = path.join(ROOT, '_audit', 'snapshots', round, guide, 'resources');
  const qa = path.join(ROOT, '_audit', 'snapshots', round, guide, 'qa.txt');
  if (!fs.existsSync(dir) || !fs.existsSync(qa)) continue;

  // which reports does the publisher flag?
  const flagged = new Set();
  for (const line of fs.readFileSync(qa, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^ERROR:\s*(DiagnosticReport\/[A-Za-z0-9._-]+):.*Constraint failed: dgr-1:/);
    if (m) flagged.add(m[1].split('/')[1]);
  }
  if (!flagged.size) continue;

  const load = f => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { return null; } };
  const byId = new Map();
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const j = load(f);
    if (j && j.resourceType && j.id) byId.set(j.resourceType + '/' + j.id, j);
  }

  for (const id of flagged) {
    const r = byId.get('DiagnosticReport/' + id);
    if (!r) { console.log(guide + '  ' + id + '  (report not in snapshot)'); continue; }
    const comp = byId.get((r.composition || {}).reference || '');
    if (!comp) { console.log(guide + '  ' + id + '  composition not resolvable'); continue; }

    // Observation entries, split by whether the invariant's path reaches them.
    const direct = [], nested = [];
    for (const s of comp.section || []) {
      for (const e of s.entry || []) if (/^Observation\//.test(e.reference || '')) direct.push(e.reference);
      const walk = ss => {
        for (const x of ss || []) {
          for (const e of x.entry || []) if (/^Observation\//.test(e.reference || '')) nested.push(e.reference);
          walk(x.section);
        }
      };
      walk(s.section);
    }

    // what result covers, including hasMember of results
    const covered = new Set();
    for (const x of r.result || []) {
      if (!x.reference) continue;
      covered.add(x.reference);
      const o = byId.get(x.reference);
      for (const hm of (o && o.hasMember) || []) if (hm.reference) covered.add(hm.reference);
    }

    const missingDirect = direct.filter(x => !covered.has(x));
    const missingNested = nested.filter(x => !covered.has(x));

    let verdict;
    if (direct.length === 0 && nested.length > 0) verdict = 'INVARIANT BLIND SPOT — all entries are in subsections';
    else if (missingDirect.length) verdict = 'REAL DEFECT — Observations missing from result';
    else if (missingNested.length) verdict = 'REAL DEFECT (in a subsection) — missing from result';
    else verdict = 'UNEXPLAINED — data looks correct and entries are reachable';

    console.log(guide.replace('ig-lt-', '').padEnd(11) + id);
    console.log('    direct Observation entries: ' + direct.length
      + '   in subsections: ' + nested.length
      + '   result covers: ' + covered.size);
    if (missingDirect.length) missingDirect.forEach(x => console.log('    MISSING from result: ' + x));
    if (missingNested.length) missingNested.forEach(x => console.log('    MISSING from result (subsection): ' + x));
    console.log('    => ' + verdict);
    console.log();
  }
}
