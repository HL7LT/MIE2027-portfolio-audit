#!/usr/bin/env node
// Build the audit report for one build round: per-guide example validity, and
// every remaining error classified by cause, so the paper can say which errors
// are external, which are terminology-server dependent, which are publisher
// artefacts, and which are genuine defects in these guides.
//
// Usage: node report.js <round> [--json]
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const round = process.argv[2] || 'r0';
const asJson = process.argv.includes('--json');

const FOUNDATION = ['ig-lt-eu', 'ig-lt-base', 'ig-lt-vitalsigns', 'ig-lt-lab', 'ig-lt-lifestyle'];
const PROGRAMME = ['ig-lt-cvd', 'ig-lt-breast', 'ig-lt-prostate', 'ig-lt-lung', 'ig-lt-cervical', 'ig-lt-colorectal'];
const LABEL = {
  'ig-lt-eu': 'European Profiles', 'ig-lt-base': 'LT Base', 'ig-lt-vitalsigns': 'Vital Signs',
  'ig-lt-lab': 'LT Pathology', 'ig-lt-lifestyle': 'Life Style',
  'ig-lt-cvd': 'CVD', 'ig-lt-breast': 'Breast Diagnostic', 'ig-lt-prostate': 'Prostate Cancer',
  'ig-lt-lung': 'Lung Cancer', 'ig-lt-cervical': 'Cervical Cancer', 'ig-lt-colorectal': 'Colorectal Cancer',
};

// Ordered so the paper can present "not ours" before "ours".
const CAUSES = [
  ['external-unpublished', 'External artefact not published'],
  ['terminology-external', 'Terminology server or system unresolvable'],
  ['terminology-ours', 'Wrong code or display we wrote'],
  ['publisher-tooling', 'Known publisher or tooling artefact'],
  ['vendored-external-copy', 'Re-hosted foreign canonical'],
  ['dependency-hygiene', 'Dependency declaration'],
  ['ig-config', 'IG configuration'],
  ['link-integrity', 'Narrative link'],
  ['internal-unresolved', 'Unresolved internal canonical'],
  ['semantic-artefact', 'Semantic defect in this guide'],
  ['unclassified', 'Unclassified'],
];

const rows = [];
for (const guide of [...FOUNDATION, ...PROGRAMME]) {
  const snap = path.join(ROOT, '_audit', 'snapshots', round, guide);
  const qa = path.join(snap, 'qa.txt');
  const statusFile = path.join(snap, 'status.txt');
  const rc = fs.existsSync(statusFile)
    ? (fs.readFileSync(statusFile, 'utf8').match(/rc=(\d+)/) || [])[1] : null;

  // A failed build can leave a partial qa.json behind, so the exit status decides
  // whether there is a result at all — never the presence of an output file.
  if (rc && rc !== '0') { rows.push({ guide, missing: true, failed: true, rc }); continue; }
  if (!fs.existsSync(qa)) { rows.push({ guide, missing: true }); continue; }

  const parsed = JSON.parse(execFileSync(process.execPath,
    [path.join(ROOT, '_audit', 'parse-qa.js'), qa, guide], { maxBuffer: 1 << 28 }).toString());

  let examples = null;
  try {
    examples = JSON.parse(execFileSync(process.execPath,
      [path.join(ROOT, '_audit', 'count-examples.js'), path.join(ROOT, guide), qa],
      { maxBuffer: 1 << 26 }).toString());
  } catch (e) { /* guide not built in place */ }

  const errs = parsed.issues.filter(i => i.severity === 'ERROR' || i.severity === 'FATAL');
  const byCause = {};
  for (const e of errs) byCause[e.cause] = (byCause[e.cause] || 0) + 1;

  rows.push({
    guide,
    label: LABEL[guide],
    tier: FOUNDATION.includes(guide) ? 'foundation' : 'programme',
    publisher: parsed.header.publisher,
    packageVersion: parsed.header.packageVersion,
    reportedErrs: parsed.header.errs,
    parsedErrs: errs.length,
    warnings: parsed.header.warnings,
    byCause,
    examples: examples && { total: examples.total, valid: examples.valid, pct: examples.pct },
    failingExamples: examples ? examples.failing : [],
    commit: fs.existsSync(path.join(snap, 'commit.txt'))
      ? fs.readFileSync(path.join(snap, 'commit.txt'), 'utf8').trim().slice(0, 12) : null,
  });
}

if (asJson) { console.log(JSON.stringify({ round, rows }, null, 1)); process.exit(0); }

// ── example validity ─────────────────────────────────────────────────────────
const pad = (s, n) => String(s === null || s === undefined ? '-' : s).padEnd(n);
const rpad = (s, n) => String(s === null || s === undefined ? '-' : s).padStart(n);

console.log('# Audit round: ' + round + '\n');
console.log('## Example validity\n');
console.log(pad('Guide', 20) + pad('Tier', 11) + pad('Commit', 14) + rpad('Valid/Total', 13) + rpad('%', 8) + rpad('Errors', 9));
console.log('-'.repeat(75));
let t = { fTot: 0, fVal: 0, pTot: 0, pVal: 0, err: 0 };
for (const r of rows) {
  if (r.missing) { console.log(pad(r.guide, 20) + (r.failed ? 'BUILD FAILED (exit ' + r.rc + ') - no validation result exists' : '(not built in this round)')); continue; }
  const e = r.examples || { valid: null, total: null, pct: null };
  console.log(pad(r.guide, 20) + pad(r.tier, 11) + pad(r.commit, 14)
    + rpad(e.valid + '/' + e.total, 13) + rpad(e.pct, 8) + rpad(r.reportedErrs, 9));
  if (r.examples) {
    if (r.tier === 'programme') { t.pTot += e.total; t.pVal += e.valid; }
    t.fTot += e.total; t.fVal += e.valid;
  }
  t.err += r.reportedErrs || 0;
}
console.log('-'.repeat(75));
console.log(pad('TOTAL portfolio', 31) + pad('', 14) + rpad(t.fVal + '/' + t.fTot, 13)
  + rpad(t.fTot ? (100 * t.fVal / t.fTot).toFixed(1) : '-', 8) + rpad(t.err, 9));
console.log(pad('TOTAL programme', 31) + pad('', 14) + rpad(t.pVal + '/' + t.pTot, 13)
  + rpad(t.pTot ? (100 * t.pVal / t.pTot).toFixed(1) : '-', 8));

// ── error classification ─────────────────────────────────────────────────────
console.log('\n## Errors by cause and guide\n');
const present = CAUSES.filter(([c]) => rows.some(r => r.byCause && r.byCause[c]));
console.log(pad('Guide', 20) + present.map(([c]) => rpad(c.slice(0, 20), 22)).join('') + rpad('Total', 8));
console.log('-'.repeat(20 + 22 * present.length + 8));
const totals = {};
for (const r of rows) {
  if (r.missing) continue;
  let sum = 0;
  const cells = present.map(([c]) => {
    const v = (r.byCause && r.byCause[c]) || 0;
    sum += v; totals[c] = (totals[c] || 0) + v;
    return rpad(v || '', 22);
  });
  console.log(pad(r.guide, 20) + cells.join('') + rpad(sum, 8));
}
console.log('-'.repeat(20 + 22 * present.length + 8));
console.log(pad('TOTAL', 20) + present.map(([c]) => rpad(totals[c] || 0, 22)).join('')
  + rpad(Object.values(totals).reduce((a, b) => a + b, 0), 8));

console.log('\n### Cause legend\n');
for (const [c, d] of present) console.log('  ' + pad(c, 24) + d);

// The publisher tallies broken narrative links separately from errs, so the
// classified total should equal errs plus the link-integrity column. Print the
// check rather than asking the reader to trust it.
console.log('\n### Reconciliation against the publisher\'s own counts\n');
console.log(pad('Guide', 20) + rpad('errs', 8) + rpad('classified', 12) + rpad('links', 8) + rpad('errs+links', 12) + '  ok');
for (const r of rows) {
  if (r.missing) continue;
  const links = (r.byCause && r.byCause['link-integrity']) || 0;
  const ok = r.parsedErrs === r.reportedErrs + links;
  console.log(pad(r.guide, 20) + rpad(r.reportedErrs, 8) + rpad(r.parsedErrs, 12)
    + rpad(links, 8) + rpad(r.reportedErrs + links, 12) + '  ' + (ok ? 'yes' : 'NO'));
}

// ── remaining failing examples ───────────────────────────────────────────────
console.log('\n## Examples still carrying errors\n');
for (const r of rows) {
  if (r.missing || !r.failingExamples || !r.failingExamples.length) continue;
  console.log(r.guide + ':');
  for (const f of r.failingExamples) console.log('  ' + rpad(f.errs, 5) + '  ' + f.ref);
}
