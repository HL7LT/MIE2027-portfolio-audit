#!/usr/bin/env node
// Find canonicals defined by more than one guide in the portfolio.
//
// The paper's duplication metric inspects ValueSet.compose membership only, so it
// cannot see two guides defining the same StructureDefinition URL. That matters
// here: ig-lt-eu and ig-lt-lab both transcribe the HL7 Europe Laboratory and IPS
// datatype profiles under the originating canonical, and every programme guide
// depends on both. The publisher picks one silently, so which definition a
// programme guide validates against is not determined by anything visible in the
// guides.
//
// Usage: node check-duplicate-canonicals.js <ig-dir> [<ig-dir> ...]
'use strict';
const fs = require('fs');
const path = require('path');

const owners = new Map();   // canonical -> [ "guide:Type/id", ... ]

for (const igDir of process.argv.slice(2)) {
  const dir = path.join(igDir, 'fsh-generated', 'resources');
  if (!fs.existsSync(dir)) continue;
  const guide = path.basename(igDir);
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    let j;
    try { j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { continue; }
    if (!j.url || j.resourceType === 'ImplementationGuide') continue;
    if (!owners.has(j.url)) owners.set(j.url, []);
    owners.get(j.url).push(guide + ':' + j.resourceType + '/' + j.id);
  }
}

const dups = [...owners.entries()]
  .filter(([, v]) => new Set(v.map(x => x.split(':')[0])).size > 1)
  .sort((a, b) => a[0].localeCompare(b[0]));

const byPair = new Map();
for (const [url, defs] of dups) {
  const guides = [...new Set(defs.map(d => d.split(':')[0]))].sort().join(' + ');
  if (!byPair.has(guides)) byPair.set(guides, []);
  byPair.get(guides).push(url);
}

console.log('canonicals defined in more than one guide: ' + dups.length);
console.log();
for (const [guides, urls] of byPair) {
  console.log(guides + '  (' + urls.length + ')');
  for (const u of urls) console.log('    ' + u);
  console.log();
}
if (!dups.length) console.log('none');
process.exit(dups.length ? 1 : 0);
