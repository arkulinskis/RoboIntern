// Checks every Casebook case (theme/assets/ri-engine.js, from _cases_data) against the real engine, and optionally writes its listings.
//   node tools/testing/codegen/cases.js                 check only (tools/check.py runs this)
//   node tools/testing/codegen/cases.js <outdir> [all]  also write one folder per case (its first model, every signal on),
//                                                       or every listed model with "all"; then run them with run.py
// Checks: unique ids, known industry/shape, every model exists and supports the case's task (and its template's needs),
// feature/validation/metric slugs exist, column codes are valid and unique, the spec has no problem with and without
// the signals, RI.generate writes code for every listed model, and every signal is read by at least one of them
// (univariate models such as ETS or STL ignore drivers; the case page says so).
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.resolve(__dirname, '..', '..', '..');
const out = process.argv[2];
const all = process.argv[3] === 'all';

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ctx = { console, UI: { esc, ICONS: {}, icon: () => '' }, setInterval, clearInterval, navigator: {}, document: {} };
ctx.window = ctx;
vm.createContext(ctx);
{
  // the whole engine (Atlas data, Casebook data, code writer) is one asset in the Forms version
  const f = path.join(ROOT, 'theme', 'assets', 'ri-engine.js');
  vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: 'ri-engine.js' });
}
const RI = ctx.RI;
const errs = [];
const bad = (c, msg) => errs.push((c ? c.no + ' ' + c.id + ': ' : '') + msg);
const slugs = list => new Set(list.map(x => x.slug));
const FEAT = slugs(RI.FEATURES), VAL = slugs(RI.VALIDATION), MET = slugs(RI.METRICS);
const seen = new Set();
let listings = 0;

if (RI.INDUSTRIES.length !== 10) bad(null, 'expected 10 industries, found ' + RI.INDUSTRIES.length);
for (const c of RI.CASES) {
  if (seen.has(c.id)) bad(c, 'duplicate id'); seen.add(c.id);
  if (!/^[a-z0-9-]+$/.test(c.id)) bad(c, 'id must be lowercase-dashed');
  if (!RI.INDUSTRY[c.ind]) bad(c, 'unknown industry ' + c.ind);
  if (!RI.SHAPES[c.shape]) bad(c, 'unknown shape ' + c.shape);
  if (!RI.TASKS[c.task]) bad(c, 'unknown task ' + c.task);
  for (const k of ['name', 'q', 'act']) if (!c[k] || typeof c[k] !== 'string') bad(c, 'missing ' + k);
  if (!c.models || c.models.length < 2) bad(c, 'needs at least two models');
  for (const f of c.feats) if (!FEAT.has(f)) bad(c, 'unknown feature recipe ' + f);
  if (c.val && !VAL.has(c.val)) bad(c, 'unknown validation ' + c.val);
  for (const m of c.metrics) if (!MET.has(m)) bad(c, 'unknown metric ' + m);
  const names = new Set();
  for (const s of c.cols.concat(c.sig.map(x => x[0]))) {
    const m = /^([a-z][a-z0-9_]*)\|([tgyYLncbxdi])([*+]*)$/.exec(s);
    if (!m) { bad(c, 'bad column "' + s + '"'); continue; }
    if (names.has(m[1])) bad(c, 'column twice: ' + m[1]); names.add(m[1]);
    if (/^(cal_|lag_|roll_)|_delta$/.test(m[1])) bad(c, 'column name clashes with generated features: ' + m[1]);
    if (m[3].includes('+') && c.task !== 'forecast') bad(c, '"+" (known ahead) only applies to forecasting: ' + m[1]);
  }
  for (const s of c.sig) if (s.length !== 4 || s.some(x => !x)) bad(c, 'signal needs [col, name, source, why]: ' + s[1]);
  if (c.tex !== undefined && typeof c.tex !== 'string') bad(c, 'tex must be a string');
  const full = RI.caseSpec(c), bare = RI.caseSpec(c, Object.fromEntries(c.sig.map((s, i) => [i, true])));
  for (const [label, spec] of [['with signals', full], ['history only', bare]]) {
    const p = RI.problem(spec);
    if (p) bad(c, label + ': ' + p);
  }
  if (c.task === 'forecast' && !(c.freq && c.h)) bad(c, 'forecast cases need freq and h');
  const offered = new Set(RI.recommend(full).map(r => r.model.slug));
  const used = {};  // signal index -> some listed model's code reads it
  c.models.forEach(([slug, why], r) => {
    const m = RI.MODEL[slug];
    if (!m) { bad(c, 'unknown model ' + slug); return; }
    if (!why) bad(c, 'model ' + slug + ' needs a reason');
    if (m.tasks.indexOf(c.task) < 0) { bad(c, slug + ' does not do ' + c.task); return; }
    if (!offered.has(slug)) bad(c, slug + ' is not offered by the Lab for this spec');
    for (const [label, spec] of [['full', full], ['bare', bare]]) {
      let files;
      try { files = RI.generate(spec, slug, c.name); } catch (e) { bad(c, slug + ' (' + label + '): generate threw ' + e.message); continue; }
      if (!files.train || !files.predict || !files.requirements) bad(c, slug + ' (' + label + '): empty listing');
      if (label === 'full') c.sig.forEach((s, i) => { if (files.train.indexOf('"' + s[0].split('|')[0] + '"') >= 0) used[i] = true; });
    }
    if (out && (all || r === 0)) {
      const testSpec = Object.assign({}, full, { file: 'data.csv' });  // run.py writes data.csv
      const files = RI.generate(testSpec, slug, c.name);
      const dir = path.join(out, c.id + '__' + slug);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'spec.json'), JSON.stringify(testSpec, null, 1));
      fs.writeFileSync(path.join(dir, 'train.py'), files.train);
      fs.writeFileSync(path.join(dir, 'predict.py'), files.predict);
      fs.writeFileSync(path.join(dir, 'requirements.txt'), files.requirements);
      listings++;
    }
  });
  c.sig.forEach((s, i) => { if (!used[i]) bad(c, 'no listed model uses the signal ' + s[0]); });
}
const perInd = RI.INDUSTRIES.map(i => i.letter + ' ' + RI.CASES.filter(c => c.ind === i.key).length).join(', ');
const shapesUsed = new Set(RI.CASES.map(c => c.shape));
if (shapesUsed.size !== Object.keys(RI.SHAPES).length) bad(null, 'a shape has no case');
if (errs.length) { console.error(errs.join('\n')); console.error(errs.length + ' problem(s)'); process.exit(1); }
console.log('cases OK: ' + RI.CASES.length + ' cases (' + perInd + '), ' + shapesUsed.size + ' shapes' + (out ? ', wrote ' + listings + ' listings to ' + out : ''));
