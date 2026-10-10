#!/usr/bin/env node
// Test the paper's RQ2 claim directly: that each QuestionnaireResponse preserves
// the linkIds of its Questionnaire.
//
// "Preserved" is checked two ways, because only the first is a validation error:
//   * required items with no answer   — the publisher reports these
//   * linkIds the response uses that the Questionnaire does not declare — the
//     response cannot be traced back to a form item at all, and the publisher is
//     quieter about it
//
// Usage: node check-linkid-preservation.js <ig-dir> [<ig-dir> ...]
'use strict';
const fs = require('fs');
const path = require('path');

function collect(items, out) {
  for (const it of items || []) {
    out.all.add(it.linkId);
    if (it.required) out.required.add(it.linkId);
    collect(it.item, out);
  }
  return out;
}
function answered(items, out) {
  for (const it of items || []) {
    out.used.add(it.linkId);
    if (it.answer && it.answer.length) out.answered.add(it.linkId);
    answered(it.item, out);
  }
  return out;
}

let totalQr = 0, clean = 0;
const problems = [];

for (const igDir of process.argv.slice(2)) {
  const dir = path.join(igDir, 'fsh-generated', 'resources');
  if (!fs.existsSync(dir)) continue;

  const qs = new Map();   // canonical -> Questionnaire
  const qrs = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    let j;
    try { j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { continue; }
    if (j.resourceType === 'Questionnaire') qs.set(j.url, j);
    if (j.resourceType === 'QuestionnaireResponse') qrs.push(j);
  }

  for (const qr of qrs) {
    totalQr++;
    const q = qs.get((qr.questionnaire || '').split('|')[0]);
    if (!q) {
      problems.push({ guide: path.basename(igDir), qr: qr.id, kind: 'questionnaire not found in this guide', detail: qr.questionnaire || '(none declared)' });
      continue;
    }
    const decl = collect(q.item, { all: new Set(), required: new Set() });
    const use = answered(qr.item, { used: new Set(), answered: new Set() });

    const orphans = [...use.used].filter(l => !decl.all.has(l));
    const unanswered = [...decl.required].filter(l => !use.answered.has(l));

    if (!orphans.length && !unanswered.length) { clean++; continue; }
    if (orphans.length) problems.push({ guide: path.basename(igDir), qr: qr.id, kind: 'linkIds not declared by the Questionnaire', detail: orphans.join(', ') });
    if (unanswered.length) problems.push({ guide: path.basename(igDir), qr: qr.id, kind: 'required items unanswered', detail: unanswered.join(', ') });
  }
}

console.log('QuestionnaireResponses examined: ' + totalQr);
console.log('fully consistent with their Questionnaire: ' + clean);
console.log();
if (!problems.length) { console.log('no linkId drift found'); process.exit(0); }
for (const p of problems) {
  console.log(p.guide + '  ' + p.qr);
  console.log('    ' + p.kind + ': ' + p.detail);
}
process.exit(1);
