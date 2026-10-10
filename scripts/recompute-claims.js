#!/usr/bin/env node
// Recompute every counted claim in the paper from the built JSON of one cohort,
// using the definitions the Methods section states.
//
//   * profiles / value sets / code systems per guide and per tier
//   * programme profiles whose immediate baseDefinition is a foundation profile
//   * foundation-use observations: distinct (foundation artefact, programme) pairs
//   * cross-guide references: distinct (source artefact, target canonical) pairs,
//     and the direction of each
//   * duplicate ValueSet.compose memberships, canonicalised
//   * Questionnaires, QuestionnaireResponses, ConceptMaps and their entries
//
// Usage: node recompute-claims.js [--json]
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const asJson = process.argv.includes('--json');

const FOUNDATION = ['ig-lt-eu', 'ig-lt-base', 'ig-lt-vitalsigns', 'ig-lt-lab', 'ig-lt-lifestyle'];
const PROGRAMME = ['ig-lt-cvd', 'ig-lt-breast', 'ig-lt-prostate', 'ig-lt-lung', 'ig-lt-cervical', 'ig-lt-colorectal'];
const ALL = [...FOUNDATION, ...PROGRAMME];

// ── load ─────────────────────────────────────────────────────────────────────
const guides = {};
const ownerOf = new Map();   // canonical URL -> guide dir

for (const g of ALL) {
  const dir = path.join(ROOT, g, 'fsh-generated', 'resources');
  if (!fs.existsSync(dir)) { console.error('not built: ' + g); continue; }
  const res = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    let j;
    try { j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { continue; }
    res.push(j);
    if (j.url) ownerOf.set(j.url, g);
  }
  const ig = res.find(r => r.resourceType === 'ImplementationGuide');
  guides[g] = {
    dir, res, ig,
    canonicalBase: ig ? ig.url.replace(/\/ImplementationGuide\/.*$/, '') : null,
    tier: FOUNDATION.includes(g) ? 'foundation' : 'programme',
  };
}

const isProfile = r => r.resourceType === 'StructureDefinition'
  && (r.derivation === 'constraint' || r.type !== 'Extension')
  && r.kind !== 'logical' && r.type !== 'Extension';

// ── artefact counts ──────────────────────────────────────────────────────────
const counts = {};
for (const [g, d] of Object.entries(guides)) {
  counts[g] = {
    tier: d.tier,
    profiles: d.res.filter(isProfile).length,
    extensions: d.res.filter(r => r.resourceType === 'StructureDefinition' && r.type === 'Extension').length,
    valueSets: d.res.filter(r => r.resourceType === 'ValueSet').length,
    codeSystems: d.res.filter(r => r.resourceType === 'CodeSystem').length,
    questionnaires: d.res.filter(r => r.resourceType === 'Questionnaire').length,
    questionnaireResponses: d.res.filter(r => r.resourceType === 'QuestionnaireResponse').length,
    conceptMaps: d.res.filter(r => r.resourceType === 'ConceptMap').length,
  };
}

// ── inheritance: where does each programme profile's baseDefinition live? ─────
const inheritance = {};
for (const g of PROGRAMME) {
  if (!guides[g]) continue;
  const rows = { total: 0, foundation: 0, sameProgramme: 0, otherProgramme: 0, euExternal: 0, fhirCore: 0, unresolved: 0, detail: [] };
  for (const sd of guides[g].res.filter(isProfile)) {
    rows.total++;
    const base = sd.baseDefinition;
    let where;
    if (!base) where = 'unresolved';
    else if (/^http:\/\/hl7\.org\/fhir\/StructureDefinition\/[A-Z]/.test(base)) where = 'fhirCore';
    else {
      const owner = ownerOf.get(base);
      if (owner && FOUNDATION.includes(owner)) where = 'foundation';
      else if (owner === g) where = 'sameProgramme';
      else if (owner) where = 'otherProgramme';
      else if (/hl7\.eu\/fhir/.test(base)) where = 'euExternal';
      else where = 'unresolved';
    }
    rows[where]++;
    rows.detail.push({ profile: sd.id, baseDefinition: base, where });
  }
  inheritance[g] = rows;
}

// ── cross-guide references ───────────────────────────────────────────────────
// Every canonical mentioned anywhere in an artefact, matched against the owner
// map, excluding ConceptMap targets as the Methods section says.
function canonicalsIn(node, out = new Set(), inConceptMapGroup = false) {
  if (node === null || typeof node !== 'object') return out;
  if (Array.isArray(node)) { for (const x of node) canonicalsIn(x, out, inConceptMapGroup); return out; }
  for (const [k, v] of Object.entries(node)) {
    if (inConceptMapGroup && (k === 'target' || k === 'element')) continue;
    if (typeof v === 'string' && /^https?:\/\//.test(v)) out.add(v.split('|')[0]);
    else canonicalsIn(v, out, inConceptMapGroup);
  }
  return out;
}

const crossRefs = [];
for (const [g, d] of Object.entries(guides)) {
  for (const r of d.res) {
    if (r.resourceType === 'ImplementationGuide') continue;
    const isCM = r.resourceType === 'ConceptMap';
    const urls = canonicalsIn(isCM ? { ...r, group: undefined } : r, new Set(), isCM);
    for (const u of urls) {
      const owner = ownerOf.get(u);
      if (!owner || owner === g) continue;
      crossRefs.push({ from: g, fromArtefact: (r.resourceType + '/' + r.id), to: owner, target: u });
    }
  }
}
const distinctCross = new Map();
for (const c of crossRefs) distinctCross.set(c.fromArtefact + ' -> ' + c.target, c);
const crossList = [...distinctCross.values()];
const dir = { progToFoundation: 0, foundationToFoundation: 0, progToProg: 0, foundationToProg: 0 };
for (const c of crossList) {
  const a = guides[c.from].tier, b = guides[c.to].tier;
  if (a === 'programme' && b === 'foundation') dir.progToFoundation++;
  else if (a === 'foundation' && b === 'foundation') dir.foundationToFoundation++;
  else if (a === 'programme' && b === 'programme') dir.progToProg++;
  else dir.foundationToProg++;
}

// foundation-use observations: distinct (foundation artefact, programme) pairs
const usePairs = new Set();
for (const c of crossList) {
  if (guides[c.from].tier !== 'programme' || guides[c.to].tier !== 'foundation') continue;
  usePairs.add(c.target + ' @ ' + c.from);
}
const servingArtefacts = new Set([...usePairs].map(p => p.split(' @ ')[0]));

// ── duplicate value set memberships ──────────────────────────────────────────
function composeKey(vs) {
  const norm = (vs.compose && vs.compose.include ? vs.compose.include : []).map(inc => ({
    system: inc.system || null,
    version: inc.version || null,
    concept: (inc.concept || []).map(c => c.code).sort(),
    filter: (inc.filter || []).map(f => f.property + f.op + f.value).sort(),
    valueSet: (inc.valueSet || []).slice().sort(),
  })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const ex = (vs.compose && vs.compose.exclude ? vs.compose.exclude : []).map(e => e.system + ':' + (e.concept || []).map(c => c.code).sort().join(',')).sort();
  return norm.length || ex.length ? JSON.stringify({ norm, ex }) : null;
}
const vsByKey = new Map();
for (const [g, d] of Object.entries(guides)) {
  for (const vs of d.res.filter(r => r.resourceType === 'ValueSet')) {
    const k = composeKey(vs);
    if (!k) continue;
    if (!vsByKey.has(k)) vsByKey.set(k, []);
    vsByKey.get(k).push(g + ':' + vs.id);
  }
}
const duplicateVs = [...vsByKey.values()]
  .filter(v => new Set(v.map(x => x.split(':')[0])).size > 1);

// ── ConceptMap entries ───────────────────────────────────────────────────────
// The paper splits target codes into those that "name a published profile" and
// those that denote a resource class, element path or anticipated destination.
// Nothing in the artefacts marks that split: targets are local codes whose
// display is free text. The reproducible proxy used here is whether the target
// concept's display or comment mentions the id or title of a profile that exists
// in this cohort. Entries are also listed individually in the JSON output so the
// split can be re-tagged by hand against a stated rule.
const profileIds = new Set();
const profileTitles = new Set();
for (const d of Object.values(guides)) {
  for (const sd of d.res.filter(isProfile)) {
    profileIds.add(sd.id);
    if (sd.name) profileTitles.add(sd.name);
  }
}
function namesAProfile(text) {
  if (!text) return false;
  for (const id of profileIds) if (id.length > 6 && text.includes(id)) return true;
  for (const nm of profileTitles) if (nm.length > 6 && text.includes(nm)) return true;
  return false;
}

const conceptMaps = [];
const conceptMapEntries = [];
for (const [g, d] of Object.entries(guides)) {
  for (const cm of d.res.filter(r => r.resourceType === 'ConceptMap')) {
    let entries = 0, targetsNamingProfile = 0, otherTargets = 0;
    for (const grp of cm.group || []) {
      for (const el of grp.element || []) {
        for (const t of el.target || []) {
          entries++;
          const text = [t.code, t.display, t.comment].filter(Boolean).join(' ');
          const hit = ownerOf.has(t.code || '') || /\/StructureDefinition\//.test(t.code || '') || namesAProfile(text);
          if (hit) targetsNamingProfile++; else otherTargets++;
          conceptMapEntries.push({
            guide: g, conceptMap: cm.id, source: el.code, target: t.code,
            display: t.display, relationship: t.relationship, namesProfile: hit,
          });
        }
      }
    }
    conceptMaps.push({
      guide: g, id: cm.id, status: cm.status, experimental: cm.experimental,
      sourceScope: cm.sourceScopeCanonical || cm.sourceScopeUri || null,
      entries, targetsNamingProfile, otherTargets,
    });
  }
}

// ── output ───────────────────────────────────────────────────────────────────
const result = { counts, inheritance, crossGuide: { distinct: crossList.length, direction: dir },
  foundationUse: { pairs: usePairs.size, servingArtefacts: servingArtefacts.size },
  duplicateValueSets: duplicateVs, conceptMaps, conceptMapEntries };

if (asJson) { console.log(JSON.stringify(result, null, 1)); process.exit(0); }

const pad = (s, n) => String(s).padEnd(n);
const rp = (s, n) => String(s).padStart(n);

console.log('## Artefact counts\n');
console.log(pad('Guide', 20) + pad('Tier', 12) + ['Profiles', 'Exts', 'ValueSets', 'CodeSys', 'Qs', 'QRs', 'CMs'].map(h => rp(h, 11)).join(''));
const tot = {};
for (const [g, c] of Object.entries(counts)) {
  console.log(pad(g, 20) + pad(c.tier, 12) + [c.profiles, c.extensions, c.valueSets, c.codeSystems, c.questionnaires, c.questionnaireResponses, c.conceptMaps].map(v => rp(v, 11)).join(''));
  for (const k of ['profiles', 'extensions', 'valueSets', 'codeSystems', 'questionnaires', 'questionnaireResponses', 'conceptMaps']) {
    tot[k] = (tot[k] || 0) + c[k];
    const tk = c.tier + '.' + k;
    tot[tk] = (tot[tk] || 0) + c[k];
  }
}
console.log('-'.repeat(101));
console.log(pad('TOTAL', 32) + ['profiles', 'extensions', 'valueSets', 'codeSystems', 'questionnaires', 'questionnaireResponses', 'conceptMaps'].map(k => rp(tot[k] || 0, 11)).join(''));
console.log(pad('  foundation', 32) + ['profiles', 'extensions', 'valueSets', 'codeSystems', 'questionnaires', 'questionnaireResponses', 'conceptMaps'].map(k => rp(tot['foundation.' + k] || 0, 11)).join(''));
console.log(pad('  programme', 32) + ['profiles', 'extensions', 'valueSets', 'codeSystems', 'questionnaires', 'questionnaireResponses', 'conceptMaps'].map(k => rp(tot['programme.' + k] || 0, 11)).join(''));

console.log('\n## Programme profile inheritance (immediate baseDefinition)\n');
console.log(pad('Guide', 20) + ['Total', 'Foundation', 'SameProg', 'OtherProg', 'EU ext', 'FHIR core', 'Unresolved'].map(h => rp(h, 12)).join(''));
const it = { total: 0, foundation: 0, sameProgramme: 0, otherProgramme: 0, euExternal: 0, fhirCore: 0, unresolved: 0 };
for (const [g, r] of Object.entries(inheritance)) {
  console.log(pad(g, 20) + [r.total, r.foundation, r.sameProgramme, r.otherProgramme, r.euExternal, r.fhirCore, r.unresolved].map(v => rp(v, 12)).join(''));
  for (const k of Object.keys(it)) it[k] += r[k];
}
console.log('-'.repeat(104));
console.log(pad('TOTAL', 20) + Object.keys(it).map(k => rp(it[k], 12)).join(''));

console.log('\n## Cross-guide references (distinct source-artefact -> target-canonical)\n');
console.log('  distinct pairs:                    ' + crossList.length);
console.log('  programme -> foundation:           ' + dir.progToFoundation);
console.log('  foundation -> foundation:          ' + dir.foundationToFoundation);
console.log('  programme -> programme:            ' + dir.progToProg);
console.log('  foundation -> programme:           ' + dir.foundationToProg);
console.log('  foundation-use observations:       ' + usePairs.size + ' pairs served by ' + servingArtefacts.size + ' foundation artefacts');

console.log('\n## Duplicate ValueSet memberships across guides\n');
if (!duplicateVs.length) console.log('  none');
for (const d of duplicateVs) console.log('  ' + d.join('  ==  '));

console.log('\n## ConceptMaps\n');
console.log(pad('Guide', 20) + pad('ConceptMap', 44) + rp('Entries', 9) + rp('ProfileTgt', 12) + rp('Other', 8));
let ce = 0, cp = 0, co = 0;
for (const cm of conceptMaps) {
  console.log(pad(cm.guide, 20) + pad(cm.id, 44) + rp(cm.entries, 9) + rp(cm.targetsNamingProfile, 12) + rp(cm.otherTargets, 8));
  ce += cm.entries; cp += cm.targetsNamingProfile; co += cm.otherTargets;
}
console.log('-'.repeat(93));
console.log(pad('TOTAL ' + conceptMaps.length + ' maps', 64) + rp(ce, 9) + rp(cp, 12) + rp(co, 8));
