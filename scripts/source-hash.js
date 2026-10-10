#!/usr/bin/env node
// Hash a guide's build inputs, so a round that carries a guide forward from an
// earlier round can prove the source did not change instead of asserting it.
//
// Covers sushi-config.yaml, ig.ini and everything under input/ — the files the
// publisher actually reads. Build output, caches and generated resources are excluded.
//
// Usage: node source-hash.js <ig-dir> [<ig-dir> ...]
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');

function collect(dir, base, out) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) collect(p, base, out);
    else out.push(path.relative(base, p).replace(/\\/g, '/'));
  }
  return out;
}

for (const arg of process.argv.slice(2)) {
  const guide = path.basename(arg);
  const dir = path.join(ROOT, guide);
  if (!fs.existsSync(dir)) { console.error('no such guide: ' + guide); continue; }

  const files = [];
  for (const f of ['sushi-config.yaml', 'ig.ini']) {
    if (fs.existsSync(path.join(dir, f))) files.push(f);
  }
  collect(path.join(dir, 'input'), dir, files);
  files.sort();

  const h = crypto.createHash('sha256');
  for (const rel of files) {
    h.update(rel);
    h.update('\0');
    h.update(fs.readFileSync(path.join(dir, rel)));
    h.update('\0');
  }
  console.log(guide.padEnd(20) + h.digest('hex') + '  (' + files.length + ' files)');
}
