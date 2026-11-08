// Generates every model x task listing with the real engine (theme/assets/ri-engine.js),
// one folder per case: spec.json + train.py + predict.py + requirements.txt.
//   node tools/testing/codegen/gen.js <outdir> [slug ...]
// tools/testing/codegen/run.py makes matching synthetic data and runs them.
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.resolve(__dirname, '..', '..', '..');
const out = process.argv[2];
const only = process.argv.slice(3);
if (!out) { console.error('usage: node gen.js <outdir> [slug ...]'); process.exit(2); }

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
const c = (name, type, role = 'feature', key = false, known = false) => ({ name, type, role, key, known });
const W = { acc: 0.5, interp: 0.25, speed: 0.25 };
const SPECS = {
  forecast_g: { columns: [c('date', 'datetime', 'time'), c('store', 'categorical', 'group'), c('region', 'categorical'), c('promo', 'boolean', 'feature', true, true),
    c('price', 'numeric', 'feature', false, true), c('footfall', 'numeric', 'feature', true, false), c('note', 'text'), c('sales', 'numeric', 'target')],
    task: 'forecast', freq: 'D', horizon: 14, rows: 'm', weights: W, intervals: true, missing: true, file: 'data.csv' },
  forecast_1: { columns: [c('month', 'datetime', 'time'), c('units', 'numeric', 'target')], task: 'forecast', freq: 'M', horizon: 12, rows: 'xs', weights: W, intervals: true, file: 'data.csv' },
  forecast_v: { columns: [c('date', 'datetime', 'time'), c('spend', 'numeric', 'feature', true, true), c('visits', 'numeric', 'feature'), c('sales', 'numeric', 'target')],
    task: 'forecast', freq: 'D', horizon: 7, rows: 's', weights: W, intervals: false, file: 'data.csv' },
  regression: { columns: [c('listing_id', 'id', 'ignore'), c('city', 'categorical', 'feature', true), c('district', 'categorical', 'feature', true), c('area', 'numeric', 'feature', true), c('rooms', 'numeric', 'feature', true),
    c('balcony', 'boolean'), c('built', 'datetime'), c('desc', 'text'), c('price', 'numeric', 'target')], task: 'regression', rows: 's', weights: W, intervals: true, missing: true, file: 'data.csv' },
  binary: { columns: [c('signup', 'datetime', 'time'), c('plan', 'categorical', 'feature', true), c('spend', 'numeric', 'feature', true), c('tickets', 'numeric'), c('bio', 'text'), c('churned', 'boolean', 'target')],
    task: 'binary', rows: 's', weights: W, file: 'data.csv' },
  multiclass: { columns: [c('a', 'numeric'), c('b', 'numeric', 'feature', true), c('c', 'numeric'), c('kind', 'categorical'), c('band', 'categorical', 'target')], task: 'multiclass', rows: 's', weights: W, file: 'data.csv' },
  anomaly: { columns: [c('txn_id', 'id', 'ignore'), c('amount', 'numeric', 'feature', true), c('merchant', 'categorical'), c('km', 'numeric'), c('card_present', 'boolean'), c('is_fraud', 'boolean', 'target')],
    task: 'anomaly', rows: 'm', weights: W, missing: true, file: 'data.csv' },
  anomaly_ts: { columns: [c('timestamp', 'datetime', 'time'), c('endpoint', 'categorical', 'group'), c('latency', 'numeric', 'target')], task: 'anomaly', freq: 'H', rows: 'm', weights: W, file: 'data.csv' },
  cluster: { columns: [c('age', 'numeric'), c('income', 'numeric', 'feature', true), c('visits', 'numeric'), c('channel', 'categorical'), c('member', 'boolean', 'target')], task: 'cluster', rows: 'm', weights: W, file: 'data.csv' }
};
let n = 0;
const tunedDone = {};
for (const m of RI.MODELS) {
  if (only.length && !only.includes(m.slug)) continue;
  for (const [name, spec] of Object.entries(SPECS)) {
    if (!m.tasks.includes(spec.task)) continue;
    if (spec.task === 'forecast' && m.tmpl === 'var' && name === 'forecast_1') continue;
    if (spec.task === 'forecast' && name === 'forecast_v' && m.tmpl !== 'var') continue;
    if (spec.task === 'anomaly' && (name === 'anomaly_ts') !== (m.tmpl === 'anomts')) continue;
    // every listing, plus a "tuned" copy of the first one per model when tuning applies
    const variants = [[name, spec]];
    if (!tunedDone[m.slug] && RI.tunable(spec, m)) { tunedDone[m.slug] = true; variants.push([name + '_tuned', Object.assign({}, spec, { tune: true })]); }
    for (const [vname, vspec] of variants) {
      const files = RI.generate(vspec, m.slug);
      const dir = path.join(out, m.slug + '__' + vname);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'spec.json'), JSON.stringify(RI.cleanSpec(vspec), null, 1));
      fs.writeFileSync(path.join(dir, 'train.py'), files.train);
      fs.writeFileSync(path.join(dir, 'predict.py'), files.predict);
      fs.writeFileSync(path.join(dir, 'requirements.txt'), files.requirements);
      const nbText = RI.notebook(files, { title: m.name + ' test', model: m.slug, spec: vspec });
      JSON.parse(nbText);
      fs.writeFileSync(path.join(dir, 'notebook.ipynb'), nbText);
      n++;
    }
  }
}
// the recommender and the parser, quickly
const p = RI.parse('date,store_id,promo,temp_c,sales\n2025-01-01,S1,true,3.5,120\n2025-01-02,S1,false,2.0,98');
const roles = Object.fromEntries(p.columns.map(x => [x.name, x.role + '/' + x.type]));
if (roles.date !== 'time/datetime' || roles.sales !== 'target/numeric' || roles.store_id !== 'group/categorical') { console.error('parse guess wrong', roles); process.exit(1); }
const spec = RI.cleanSpec({ columns: p.columns, task: RI.inferTask(p.columns), freq: 'D', horizon: 14, rows: 'm' });
if (spec.task !== 'forecast') { console.error('task guess wrong', spec.task); process.exit(1); }
const rec = RI.recommend(spec);
if (!rec.length || rec.some(r => !(r.score >= 0 && r.score <= 100))) { console.error('recommend broken'); process.exit(1); }
console.log('generated ' + n + ' listings; top picks for the parse test: ' + rec.slice(0, 4).map(r => r.model.slug + ' ' + r.score.toFixed(1)).join(', '));
