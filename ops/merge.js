// Merge Lightfield extraction results into the hub.
// Usage:  node ops/merge.js <hub.html> <results.json> [--state ops/state.json]
//
// <results.json> is an ARRAY of objects in the shape defined by ops/extract-spec.md.
// Deals not present in the array are left untouched. Safe to run repeatedly.

const fs = require('fs');
const args = process.argv.slice(2);
const P = args[0] || 'index.html';
const R = args[1] || 'extract/results.json';
const STATE = (args.indexOf('--state') > -1) ? args[args.indexOf('--state') + 1] : 'ops/state.json';

let h = fs.readFileSync(P, 'utf8');
const m = h.match(/const DEALS=(\[[\s\S]*?\]);\n/);
if (!m) throw new Error('DEALS literal not found in ' + P);
const D = eval(m[1]);
const res = JSON.parse(fs.readFileSync(R, 'utf8'));
const byId = {}; D.forEach((d, i) => byId[d.id] = i);

function applicable(A) {
  const k = ['infra', 'res', 'goal', 'sdkAI', 'weblog', 'crm', 'camp', 'val'];
  if (A.infra === 0) k.push('cp', 'cloud', 'acc');
  if (A.camp === 1) k.push('sys');
  return k;
}
const held = (A, k) => { const x = A[k]; return !(x === undefined || x === null || (Array.isArray(x) && !x.length)); };
function cov(A) { A = A || {}; const app = applicable(A); return { c: app.filter(k => held(A, k)).length, t: app.length }; }

let patched = 0; const skipped = [];
res.forEach(r => {
  const i = byId[r.oppId];
  if (i === undefined) { skipped.push(r.name || r.oppId); return; }
  const d = D[i];
  const A = {};
  Object.entries(r.a || {}).forEach(([k, v]) => { if (v !== null && v !== undefined && !(Array.isArray(v) && !v.length)) A[k] = v; });
  d.a = A;
  if (r.cite && Object.keys(r.cite).length) d.cite = r.cite; else delete d.cite;
  if (r.conf && Object.keys(r.conf).length) d.conf = r.conf; else delete d.conf;
  if (r.notes && r.notes.length) d.notes = r.notes; else delete d.notes;
  if (r.ctx) d.ctx = r.ctx;
  if (r.why) d.why = r.why; else delete d.why;
  if (typeof r.noteCount === 'number') d.nc = r.noteCount;
  patched++;
});

// recompute coverage for every deal so pill and dropdown label always agree
D.forEach(d => { d.cov = cov(d.a).c; });

h = h.slice(0, m.index) + 'const DEALS=' + JSON.stringify(D) + ';\n' + h.slice(m.index + m[0].length);

// rebuild dropdown option labels: "<name> — <sector · region · value> ✓answered/applicable"
const selM = h.match(/<select id="dealsel"[\s\S]*?<\/select>/);
if (!selM) throw new Error('#dealsel not found');
let sel = selM[0].replace(/<option value="(\d+)"([^>]*)>([\s\S]*?)<\/option>/g, (full, idx, attrs) => {
  const d = D[+idx]; if (!d) return full;
  const c = cov(d.a);
  const base = [d.n, [d.sector, d.reg, d.valS].filter(Boolean).join(' · ')].filter(Boolean).join(' — ');
  return '<option value="' + idx + '"' + attrs + '>' + base + ' ✓' + c.c + '/' + c.t + '</option>';
});
h = h.slice(0, selM.index) + sel + h.slice(selM.index + selM[0].length);

fs.writeFileSync(P, h);

// refresh ops/state.json so the next run knows what it saw
try {
  const st = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  const seen = {}; res.forEach(r => seen[r.oppId] = r);
  st.deals.forEach(s => {
    const d = D[byId[s.oppId]];
    if (!d) return;
    s.cov = cov(d.a).c;
    s.why = d.why || null;
    if (typeof d.nc === 'number') s.nc = d.nc;
  });
  fs.writeFileSync(STATE, JSON.stringify(st, null, 1));
} catch (e) { console.log('state not updated:', e.message); }

const tot = D.filter((d, i) => true);
const drop = [...new Set([...h.matchAll(/<option value="(\d+)"/g)].map(x => +x[1]))];
const sum = drop.reduce((a, i) => { const c = cov(D[i].a); a.c += c.c; a.t += c.t; if (!c.c) a.z++; return a; }, { c: 0, t: 0, z: 0 });
console.log('patched ' + patched + ', skipped ' + skipped.length + (skipped.length ? ' (' + skipped.join(', ') + ')' : ''));
console.log('dropdown coverage: ' + sum.c + ' of ' + sum.t + ' applicable answers across ' + drop.length + ' deals (' + Math.round(sum.c / sum.t * 100) + '%), ' + sum.z + ' deals at zero');
console.log('written ' + P + ' (' + h.length + ' bytes)');
