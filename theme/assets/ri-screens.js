/* ri-screens.js: the three big interactive screens, moved unchanged from the JavaScript pages (web/pages/lab, atlas,
   cases): UI.page(name, opts, mount) registers them; Components/Screen mounts one inside a Forms page.
   Their dialogs and confirmations go through RI.host (Python, client_code/ri.py). */
/* ---- lab */
(function () {
  var esc = UI.esc;
  var DEFAULT_W = { acc: 0.5, interp: 0.25, speed: 0.25 };

  function blankState() { return { text: '', spec: null, pick: null, file: 'train', showAll: false, dataset: null }; }
  function sub(n) { return '<sub>' + n + '</sub>'; }

  /* Merge a fresh parse with what the person already set for columns of the same name. */
  function mergeColumns(fresh, old) {
    var prev = {};
    (old || []).forEach(function (c) { prev[c.name] = c; });
    var hadTarget = (old || []).some(function (c) { return c.role === 'target' && fresh.some(function (f) { return f.name === c.name; }); });
    var hadTime = (old || []).some(function (c) { return c.role === 'time' && fresh.some(function (f) { return f.name === c.name; }); });
    return fresh.map(function (c) {
      var p = prev[c.name];
      if (!p) {
        if (hadTarget && c.role === 'target') c.role = 'feature';
        if (hadTime && c.role === 'time') c.role = 'feature';
        return c;
      }
      return { name: c.name, type: p.type, role: p.role, key: p.key, known: p.known, missing: c.missing };
    });
  }

  function simplexSvg(w) {
    var A = [120, 22], I = [20, 196], S = [220, 196];
    var tot = (w.acc + w.interp + w.speed) || 1;
    var P = [(w.acc * A[0] + w.interp * I[0] + w.speed * S[0]) / tot, (w.acc * A[1] + w.interp * I[1] + w.speed * S[1]) / tot];
    var grid = '';
    for (var k = 1; k < 4; k++) {
      var t = k / 4, lerp = function (p, q, u) { return [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u]; };
      [[A, I, S], [I, S, A], [S, A, I]].forEach(function (v) {
        var p1 = lerp(v[0], v[1], t), p2 = lerp(v[0], v[2], t);
        grid += '<line class="gl" x1="' + p1[0] + '" y1="' + p1[1] + '" x2="' + p2[0] + '" y2="' + p2[1] + '"/>';
      });
    }
    return '<svg viewBox="0 0 240 222" role="slider" aria-label="Priorities: drag between accuracy, interpretability and speed" data-simplex>' +
      '<polygon class="tri" points="' + [A, I, S].map(function (p) { return p.join(','); }).join(' ') + '"/>' + grid +
      '<text class="lbl" x="120" y="13" text-anchor="middle">accuracy</text>' +
      '<text class="lbl" x="6" y="215">interpretability</text><text class="lbl" x="234" y="215" text-anchor="end">speed</text>' +
      '<circle class="pt" cx="' + P[0].toFixed(1) + '" cy="' + P[1].toFixed(1) + '" r="7"/></svg>';
  }
  function weightsFromPoint(svg, ev) {
    var r = svg.getBoundingClientRect(), x = (ev.clientX - r.left) * 240 / r.width, y = (ev.clientY - r.top) * 222 / r.height;
    var A = [120, 22], I = [20, 196], S = [220, 196];
    var det = (I[1] - S[1]) * (A[0] - S[0]) + (S[0] - I[0]) * (A[1] - S[1]);
    var a = ((I[1] - S[1]) * (x - S[0]) + (S[0] - I[0]) * (y - S[1])) / det;
    var i = ((S[1] - A[1]) * (x - S[0]) + (A[0] - S[0]) * (y - S[1])) / det;
    var s = 1 - a - i;
    a = Math.max(0, a); i = Math.max(0, i); s = Math.max(0, s);
    var t = a + i + s || 1;
    var r2 = function (v) { return Math.round(v / t * 100) / 100; };
    return { acc: r2(a), interp: r2(i), speed: r2(s) };
  }

  UI.page('lab', { title: 'The Lab', nav: 'Lab', icon: 'flask', order: 10 }, function (view, ctx) {
    var st = UI.store.get('lab', null) || blankState();
    var load = UI.store.get('lab-load', null), pickReq = UI.store.get('lab-pick', null);
    if (load && load.spec) {
      var sp = RI.cleanSpec(load.spec);
      st = blankState();
      st.spec = sp; st.pick = load.model || null;
      st.text = load.text || sp.columns.map(function (c) { return /[,"]/.test(c.name) ? '"' + c.name.replace(/"/g, '""') + '"' : c.name; }).join(',');
      UI.store.set('lab-load', null);
    }
    if (pickReq) { st.pick = pickReq; UI.store.set('lab-pick', null); }
    var parsed = { delim: ',', rows: 0 }, recs = [], files = null, datasets = null;
    var timer = null;

    function save() { UI.store.set('lab', st); }
    function spec() { return st.spec; }

    function reparse() {
      var p = RI.parse(st.text);
      parsed = p;
      if (!p.columns.length) { st.spec = null; return; }
      var old = st.spec;
      var cols = mergeColumns(p.columns, old && old.columns);
      var roleName = function (list, role) { return ((list || []).filter(function (c) { return c.role === role; })[0] || {}).name; };
      var same = old && old.columns && old.columns.length && roleName(old.columns, 'target') === roleName(cols, 'target') && roleName(old.columns, 'time') === roleName(cols, 'time');
      var task = same ? old.task : RI.inferTask(cols);
      st.spec = RI.cleanSpec({ columns: cols, task: task, freq: old ? old.freq : 'D', horizon: old ? old.horizon : 14, rows: old ? old.rows : 'm',
        weights: old ? old.weights : DEFAULT_W, intervals: old ? old.intervals : false, missing: old ? old.missing || cols.some(function (c) { return c.missing; }) : cols.some(function (c) { return c.missing; }),
        file: old ? old.file : 'data.csv' });
      st.spec.columns.forEach(function (c, i) { c.missing = cols[i].missing; });
    }

    /* ---------------------------------------------------------------- drawing */
    view.innerHTML = '<div class="ui-wrap"><header class="lb-head">' +
      '<h1>The Lab: describe your data. <em>Get the model, and the code.</em></h1>' +
      '<p class="muted">Paste a header row, or a few rows. Mark what to predict, which column is time, and which drivers matter. The ranking and the Python update as you go. ' +
      'Your data never leaves this browser.</p></header>' +
      '<div class="lb-grid"><div class="lb-mainc">' +
        '<section class="lb-sec" data-s1></section><section class="lb-sec" data-s2></section><section class="lb-sec lb-task" data-s3></section></div>' +
        '<aside class="lb-side"><section class="lb-sec" data-s4></section></aside></div>' +
      '<section class="lb-sec" data-s5 style="margin-top:18px"></section></div>';
    var S1 = view.querySelector('[data-s1]'), S2 = view.querySelector('[data-s2]'), S3 = view.querySelector('[data-s3]'), S4 = view.querySelector('[data-s4]'), S5 = view.querySelector('[data-s5]');

    function drawS1() {
      S1.innerHTML = '<h2><span class="ri-sec">§1</span>Your data</h2><p class="lb-lead">Paste the header row of your table (CSV, TSV or spreadsheet copy). A few sample rows sharpen the type guesses.</p>' +
        '<div class="lb-samples"><span>Try one:</span>' + RI.SAMPLES.map(function (s) { return '<button type="button" class="lb-chip" data-sample="' + s.key + '">' + esc(s.name) + '</button>'; }).join('') +
        '<a class="lb-chip lb-cases" href="#cases">' + UI.icon('cases') + 'or start from one of ' + RI.CASES.length + ' cases</a>' +
        (ctx.me ? '<span class="ui-spacer"></span><span class="lb-saved" data-saved-box></span>' : '') + '</div>' +
        '<textarea class="lb-paste" data-paste spellcheck="false" autocomplete="off" aria-label="Header row and sample rows" placeholder="date,store_id,promo,temp_c,sales\n2025-03-01,S01,true,11.5,188">' + esc(st.text) + '</textarea>' +
        '<div class="lb-info" data-info></div><div class="lb-notation ri-tex" data-notation hidden></div>';
      drawInfo();
      if (ctx.me) drawSaved();
    }
    function drawInfo() {
      var info = S1.querySelector('[data-info]'), sp = spec();
      if (!sp) { info.innerHTML = '<span>No columns yet.</span>'; S1.querySelector('[data-notation]').hidden = true; return; }
      info.innerHTML = '<span>' + UI.icon('check') + sp.columns.length + ' columns</span><span>delimiter: ' + esc(parsed.delim === '\t' ? 'tab' : parsed.delim) + '</span>' +
        '<span>' + (parsed.rows ? parsed.rows + ' sample row' + (parsed.rows === 1 ? '' : 's') : 'header only: types guessed from names') + '</span>' +
        '<label class="lb-known" style="visibility:visible">file <input type="text" data-file-name value="' + esc(sp.file) + '" style="min-height:28px;padding:2px 6px;width:150px;font:inherit"></label>' +
        (ctx.me ? '<button type="button" class="ui-btn sm ghost" data-save-ds>' + UI.icon('save') + 'Save description</button>' : '');
      var n = S1.querySelector('[data-notation]');
      n.hidden = false; n.innerHTML = RI.tex(RI.notation(sp), true);
    }
    function drawSaved() {
      var box = S1.querySelector('[data-saved-box]');
      if (!box) return;
      if (datasets === null) { box.innerHTML = ''; return; }
      box.innerHTML = datasets.length ? '<select data-load-ds aria-label="Open a saved data description"><option value="">Open saved…</option>' +
        datasets.map(function (d) { return '<option value="' + esc(d.id) + '"' + (st.dataset === d.id ? ' selected' : '') + '>' + esc(d.name) + '</option>'; }).join('') + '</select>' : '';
    }

    function drawS2() {
      var sp = spec();
      if (!sp) { S2.innerHTML = '<h2><span class="ri-sec">§2</span>Columns &amp; roles</h2><p class="lb-lead">Paste something in §1, or pick a sample, and your columns appear here.</p>'; return; }
      var fc = sp.task === 'forecast', xi = 0;
      S2.innerHTML = '<h2><span class="ri-sec">§2</span>Columns &amp; roles</h2><p class="lb-lead">Set each column\'s role and type. Star ★ the drivers you believe matter most: the code builds extra features around them.' +
        (fc ? ' Tick <b>known ahead</b> for drivers you will know for the forecast period (promos, prices, holidays, weather forecasts).' : '') +
        (sp.task === 'anomaly' ? ' No target needed. A true/false <b>y</b> (known anomalies) is only used to measure the detector; a numeric <b>y</b> with a time column <b>t</b> is a metric to watch over time.' : '') +
        (sp.task === 'cluster' ? ' No target needed: the features <b>x</b> form the groups. A <b>y</b>, if you keep one, is only described per cluster.' : '') + '</p>' +
        '<div class="lb-legend">' + RI.ROLES.map(function (r) { return '<span><span class="ri-role ' + r[0] + '">' + r[1] + '</span>' + r[2] + '</span>'; }).join('') + '<span>★ key driver</span></div>' +
        '<div class="lb-cols">' + sp.columns.map(function (c, i) {
          var idx = c.role === 'target' ? 'y' : c.role === 'time' ? 't' : c.role === 'group' ? 'g' : c.role === 'ignore' ? '∅' : 'x' + sub(++xi);
          var numish = c.type === 'numeric' || c.type === 'boolean';
          return '<div class="lb-col is-' + c.role + (c.key ? ' key' : '') + '" data-i="' + i + '"><span class="lb-idx">' + idx + '</span>' +
            '<span class="lb-name"><span>' + esc(c.name) + '</span>' + (c.missing ? '<span class="lb-miss" title="Blanks in the sample rows">NA</span>' : '') + '</span>' +
            '<select data-type aria-label="Type of ' + esc(c.name) + '">' + Object.keys(RI.TYPES).map(function (t) { return '<option value="' + t + '"' + (c.type === t ? ' selected' : '') + '>' + RI.TYPE_SYM[t] + ' ' + t + '</option>'; }).join('') + '</select>' +
            '<div class="lb-roles" role="group" aria-label="Role of ' + esc(c.name) + '">' + RI.ROLES.map(function (r) {
              return '<button type="button" data-role="' + r[0] + '" class="' + (c.role === r[0] ? 'on' : '') + '" title="' + r[2] + '" aria-pressed="' + (c.role === r[0]) + '">' + r[1] + '</button>';
            }).join('') + '</div>' +
            '<button type="button" class="lb-star' + (c.key ? ' on' : '') + '" data-key title="Key driver" aria-pressed="' + c.key + '">★</button>' +
            '<label class="lb-known' + (fc && c.role === 'feature' && numish ? '' : ' off') + '"><input type="checkbox" data-known' + (c.known ? ' checked' : '') + '> known ahead</label></div>';
        }).join('') + '</div><div class="lb-problem" data-problem></div>';
      drawProblem();
    }
    function drawProblem() {
      var box = S2.querySelector('[data-problem]');
      if (!box) return;
      var p = spec() && RI.problem(spec());
      box.innerHTML = p ? '<div class="ui-error">' + esc(p) + '</div>' : '';
    }

    function drawS3() {
      var sp = spec();
      if (!sp) { S3.innerHTML = '<h2><span class="ri-sec">§3</span>The task</h2><p class="lb-lead">Forecast, regression, classification, anomalies or clusters: guessed once there are columns.</p>'; return; }
      var f = RI.FREQ[sp.freq], w = sp.weights, d = RI.derive(sp), unsup = sp.task === 'anomaly' || sp.task === 'cluster';
      S3.innerHTML = '<h2><span class="ri-sec">§3</span>The task</h2><p class="lb-lead">Guessed from your target and time column. Change anything.</p>' +
        '<div class="ui-seg" role="group" aria-label="Task">' + Object.keys(RI.TASKS).map(function (t) { return '<button type="button" data-task="' + t + '" class="' + (sp.task === t ? 'on' : '') + '">' + RI.TASKS[t] + '</button>'; }).join('') + '</div>' +
        (sp.task === 'forecast' || (sp.task === 'anomaly' && d.time) ? '<div class="lb-fc"><label>Frequency<select data-freq>' + Object.keys(RI.FREQ).map(function (k) { return '<option value="' + k + '"' + (sp.freq === k ? ' selected' : '') + '>' + RI.FREQ[k].name + '</option>'; }).join('') + '</select></label>' +
          (sp.task === 'forecast' ? '<label>Horizon h<input type="number" min="1" max="1000" value="' + sp.horizon + '" data-horizon style="width:96px"></label><span class="muted small" style="padding-bottom:9px">' + esc(f.unit) + ' ahead · season m = ' + f.season + '</span>'
            : '<span class="muted small" style="padding-bottom:9px">season m = ' + f.season + ' (for the over-time detector)</span>') + '</div>' : '') +
        '<div class="lb-row3"><div><span class="lb-field-label">How many rows?</span><div class="ui-seg" role="group" aria-label="Rows">' + RI.ROW_ORDER.map(function (r) {
          return '<button type="button" data-rows="' + r + '" class="' + (sp.rows === r ? 'on' : '') + '" title="' + esc(RI.ROWS[r]) + '">' + esc(RI.ROWS[r].replace(' rows', '')) + '</button>'; }).join('') + '</div>' +
          '<div class="ui-stack" style="margin-top:16px">' + (unsup ? '' : '<label class="ui-check"><input type="checkbox" data-intervals' + (sp.intervals ? ' checked' : '') + '><span>I need prediction intervals (uncertainty)</span></label>') +
          '<label class="ui-check"><input type="checkbox" data-missing' + (sp.missing ? ' checked' : '') + '><span>My data has missing values</span></label>' +
          '<label class="ui-check"><input type="checkbox" data-tune' + (sp.tune ? ' checked' : '') + '><span>Cross-validated tuning <span class="muted">(adds an Optuna search to the code)</span></span></label></div></div>' +
          '<div class="lb-simplex"><span class="lb-field-label">Priorities <span class="muted" style="font-weight:400">(drag the point)</span></span>' + simplexSvg(w) +
          '<div class="w" data-w>' + RI.tex('\\mathbf w = (' + w.acc.toFixed(2) + ',\\ ' + w.interp.toFixed(2) + ',\\ ' + w.speed.toFixed(2) + ')', false) + '</div></div></div>';
    }

    function drawS4() {
      var sp = spec(), prob = sp && RI.problem(sp);
      if (!sp || prob) {
        S4.innerHTML = '<h2><span class="ri-sec">§4</span>Ranking</h2><p class="lb-lead">' + (sp ? esc(prob) : 'Models appear here, ranked for your data.') + '</p>';
        return;
      }
      var list = st.showAll ? recs : recs.slice(0, 7);
      S4.innerHTML = '<h2><span class="ri-sec">§4</span>Ranking</h2>' +
        '<div class="lb-formula ri-tex">' + RI.tex('S(m) = 20\\,\\mathbf w^{\\top}\\!(p_m, q_m, r_m) + \\textstyle\\sum_k \\delta_k(m)', false) + '</div>' +
        '<p class="muted small" style="margin-top:-6px">p = accuracy potential, q = interpretability, r = speed (each 1 to 5), plus the adjustments δ for your data.</p>' +
        '<div class="lb-ranks">' + list.map(function (r, i) {
          var on = r.model.slug === st.pick;
          return '<button type="button" class="lb-rank' + (on ? ' on' : '') + '" data-pick="' + r.model.slug + '" aria-pressed="' + on + '"><span class="lb-rk">' + (recs.indexOf(r) + 1) + '</span>' +
            '<span><b>' + esc(r.model.name) + '</b><br><span class="fam">' + esc(RI.FAMILIES[r.model.family].name) + '</span></span><span class="lb-score">' + r.score.toFixed(1) + '</span>' +
            '<span class="lb-bar"><i style="width:' + r.score.toFixed(1) + '%"></i></span>' +
            (r.badges.length ? '<span class="lb-badges">' + r.badges.map(function (b) { return '<span class="ui-badge ' + b[1] + '">' + esc(b[0]) + '</span>'; }).join('') + '</span>' : '') +
            (on ? '<span class="lb-why">' + r.adj.map(function (a) {
              var cls = a.v > 0.01 ? 'pos' : a.v < -0.01 ? 'neg' : 'zero';
              return '<div><span class="v ' + cls + '">' + (Math.abs(a.v) < 0.01 ? '·' : (a.v > 0 ? '+' : '−') + Math.abs(a.v)) + '</span><span>' + esc(a.text) + '</span></div>';
            }).join('') + '<span class="parts">base ' + r.base.toFixed(1) + ' = ' + r.parts.acc.toFixed(1) + ' + ' + r.parts.interp.toFixed(1) + ' + ' + r.parts.speed.toFixed(1) + '</span></span>' : '') + '</button>';
        }).join('') + '</div>' +
        (recs.length > 7 ? '<button type="button" class="ui-btn sm ghost lb-more" data-show-all>' + (st.showAll ? 'Show the top 7' : 'Show all ' + recs.length + ' models') + '</button>' : '');
    }

    function drawS5() {
      var sp = spec(), prob = sp && RI.problem(sp);
      if (!sp || prob || !files) {
        S5.innerHTML = '<h2><span class="ri-sec">§5</span>The code</h2><div class="lb-empty-code">' + UI.icon('code') + '<p style="margin:8px 0 0">' +
          (sp && prob ? esc(prob) : 'Your train.py, predict.py and requirements.txt will be written here.') + '</p></div>';
        return;
      }
      var m = RI.MODEL[st.pick], d = RI.derive(sp);
      var what = sp.task === 'cluster' ? 'segments' : sp.task === 'anomaly' && !d.target ? 'unusual rows' : '<code>' + esc(d.target) + '</code>';
      var tuneNote = sp.tune && !RI.tunable(sp, m) ? '<p class="small muted" style="margin:-4px 0 10px">' + (m.tmpl === 'fm' ? esc(m.short) + ' is zero-shot: there is nothing to tune.' : sp.task === 'anomaly' && m.tmpl === 'anom' ? 'Tuning needs a true/false column of known anomalies as y to score against.' : esc(m.short) + ' fits its own parameters, so the listing has no search.') + '</p>' : '';
      S5.innerHTML = '<div class="lb-code-head"><div><span class="ri-sec">§5</span><span class="ri-listing-no">Listing</span><h2>' + esc(m.name) + ' for ' + what + '</h2></div>' +
        '<div class="ui-row"><a class="ui-btn sm" href="#atlas/model/' + m.slug + '" data-go="atlas/model/' + m.slug + '">' + UI.icon('book') + '<span>About ' + esc(m.short) + '</span></a>' +
        '<button type="button" class="ui-btn sm primary" data-save-snippet>' + UI.icon('save') + '<span>Save to notebook</span></button></div></div>' +
        tuneNote + RI.codeBlock(files, st.file) +
        '<p class="lb-run">$ pip install -r requirements.txt &nbsp;&amp;&amp;&nbsp; python train.py &nbsp;&amp;&amp;&nbsp; python predict.py' + (sp.task === 'forecast' || m.tmpl === 'anomts' ? '' : ' new.csv') + '</p>';
    }

    function compute() {
      var sp = spec();
      recs = sp && !RI.problem(sp) ? RI.recommend(sp) : [];
      if (recs.length && !recs.some(function (r) { return r.model.slug === st.pick; })) st.pick = recs[0].model.slug;
      files = recs.length ? RI.generate(sp, st.pick) : null;
    }
    function refresh(parts) {
      compute(); save();
      if (parts.indexOf(1) >= 0) drawInfo();
      if (parts.indexOf(2) >= 0) drawS2(); else drawProblem();
      if (parts.indexOf(3) >= 0) drawS3();
      drawS4(); drawS5();
    }
    function drawAll() { compute(); save(); drawS1(); drawS2(); drawS3(); drawS4(); drawS5(); }

    /* ---------------------------------------------------------------- events */
    function colOf(el) { var r = el.closest('[data-i]'); return r ? spec().columns[+r.getAttribute('data-i')] : null; }
    view.addEventListener('input', function (e) {
      if (e.target.matches('[data-paste]')) {
        st.text = e.target.value; st.dataset = null;
        clearTimeout(timer);
        timer = setTimeout(function () { reparse(); refresh([1, 2, 3]); }, 220);
      } else if (e.target.matches('[data-horizon]')) {
        var v = parseInt(e.target.value, 10);
        if (v >= 1 && v <= 1000) { spec().horizon = v; refresh([]); }
      } else if (e.target.matches('[data-file-name]')) {
        spec().file = (e.target.value || 'data.csv').trim().slice(0, 120) || 'data.csv'; refresh([]);
      }
    });
    view.addEventListener('change', function (e) {
      var sp = spec(), c;
      if (e.target.matches('[data-type]') && (c = colOf(e.target))) {
        c.type = e.target.value;
        if (c.role === 'target') sp.task = RI.inferTask(sp.columns);
        refresh([2, 3]);
      } else if (e.target.matches('[data-known]') && (c = colOf(e.target))) { c.known = e.target.checked; refresh([]); }
      else if (e.target.matches('[data-freq]')) { sp.freq = e.target.value; refresh([3]); }
      else if (e.target.matches('[data-intervals]')) { sp.intervals = e.target.checked; refresh([]); }
      else if (e.target.matches('[data-missing]')) { sp.missing = e.target.checked; refresh([]); }
      else if (e.target.matches('[data-tune]')) { sp.tune = e.target.checked; refresh([]); }
      else if (e.target.matches('[data-load-ds]') && e.target.value) {
        var ds = datasets.filter(function (d) { return d.id === e.target.value; })[0];
        if (ds) {
          st.spec = RI.cleanSpec(ds.spec); st.dataset = ds.id;
          st.text = ds.spec.columns.map(function (x) { return x.name; }).join(',');
          parsed = { delim: ',', rows: 0 };
          drawAll(); UI.toast('Opened “' + ds.name + '”', 'ok');
        }
      }
    });
    view.addEventListener('click', function (e) {
      var t;
      if ((t = e.target.closest('[data-sample]'))) {
        var s = RI.SAMPLES.filter(function (x) { return x.key === t.getAttribute('data-sample'); })[0];
        st = blankState(); st.text = s.text; reparse();
        var sp = spec();
        sp.columns.forEach(function (c) { if (s.tweak) s.tweak(c); });
        sp.task = s.task; sp.freq = s.freq || 'D'; sp.horizon = s.horizon || 14; sp.rows = s.rows || 'm'; sp.intervals = !!s.intervals; sp.tune = false;
        sp.file = s.key + '.csv';
        drawAll(); return;
      }
      var c;
      if ((t = e.target.closest('[data-role]')) && (c = colOf(t))) {
        var role = t.getAttribute('data-role'), sp2 = spec();
        if (role === 'target' || role === 'time') sp2.columns.forEach(function (o) { if (o !== c && o.role === role) o.role = 'feature'; });
        c.role = role;
        if (role === 'target' || role === 'time') sp2.task = RI.inferTask(sp2.columns);
        if (role === 'group' && c.type === 'id') c.type = 'categorical';
        refresh([1, 2, 3]); return;
      }
      if ((t = e.target.closest('[data-key]')) && (c = colOf(t))) { c.key = !c.key; refresh([2]); return; }
      if ((t = e.target.closest('[data-task]'))) { spec().task = t.getAttribute('data-task'); refresh([1, 2, 3]); return; }
      if ((t = e.target.closest('[data-rows]'))) { spec().rows = t.getAttribute('data-rows'); refresh([3]); return; }
      if ((t = e.target.closest('[data-pick]'))) { st.pick = t.getAttribute('data-pick'); refresh([]); if (innerWidth < 1080) S5.scrollIntoView({ behavior: 'smooth' }); return; }
      if (e.target.closest('[data-show-all]')) { st.showAll = !st.showAll; drawS4(); save(); return; }
      if (e.target.closest('[data-save-snippet]')) { saveSnippet(); return; }
      if (e.target.closest('[data-save-ds]')) { saveDataset(); return; }
    });
    RI.wireCode(view, function () { return files || {}; }, function (k) { st.file = k; save(); drawS5(); }, function () {
      var m = RI.MODEL[st.pick], d = RI.derive(spec());
      return { title: m.name + (d.target ? ' for ' + d.target : ''), model: st.pick, spec: spec() };
    });

    // the priority simplex: click or drag
    var dragging = false;
    function setW(ev) {
      var svg = view.querySelector('[data-simplex]');
      if (!svg) return;
      spec().weights = weightsFromPoint(svg, ev);
      var w = spec().weights;
      svg.outerHTML = simplexSvg(w);
      view.querySelector('[data-w]').innerHTML = RI.tex('\\mathbf w = (' + w.acc.toFixed(2) + ',\\ ' + w.interp.toFixed(2) + ',\\ ' + w.speed.toFixed(2) + ')', false);
      compute(); save(); drawS4(); drawS5();
    }
    view.addEventListener('pointerdown', function (e) { if (e.target.closest('[data-simplex]')) { dragging = true; setW(e); e.preventDefault(); } });
    var onMove = function (e) { if (dragging) setW(e); };
    var onUp = function () { dragging = false; };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);

    /* ---------------------------------------------------------------- saving */
    function needAccount(what) {
      save();
      UI.confirm({ title: 'Save ' + what + ' to your notebook', text: 'A free account keeps your listings and data descriptions. Your Lab draft stays right here while you sign up.', ok: 'Create an account' })
        .then(function (yes) { if (yes) { UI.after = '#lab'; UI.go('auth', 'signup'); } });
    }
    /* The two save dialogs are Python Forms now (client_code/Dialogs/SaveListing, SaveDataset, through RI.host). */
    function saveSnippet() {
      if (!ctx.me) return needAccount('this listing');
      var m = RI.MODEL[st.pick], d = RI.derive(spec());
      RI.host.save_listing(JSON.stringify({ title: m.name + ' · ' + (d.target || RI.TASK_SHORT[spec().task].toLowerCase()), model: st.pick, spec: spec(), files: files }));
    }
    function saveDataset() {
      var cur = datasets && st.dataset ? datasets.filter(function (d) { return d.id === st.dataset; })[0] : null;
      Promise.resolve(RI.host.save_dataset(JSON.stringify({ spec: spec(), current: cur ? { id: cur.id, name: cur.name } : null,
        name: cur ? cur.name : (RI.derive(spec()).target || 'My') + ' data' }))).then(function (id) {
        if (id) { st.dataset = id; save(); loadDatasets(); }
      });
    }
    function loadDatasets() {
      return UI.apiQuiet('list_datasets').then(function (r) { datasets = r.datasets; drawSaved(); }, function () {});
    }

    if (st.text && !st.spec) reparse();
    else if (st.text) { var pp = RI.parse(st.text); parsed = { delim: pp.delim, rows: pp.rows }; }
    drawAll();
    RI.whenTex(function () { drawInfo(); drawS3(); drawS4(); });
    if (ctx.me) loadDatasets();
    return { ready: Promise.resolve(), destroy: function () { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); clearTimeout(timer); } };
  });
})();
/* ---- atlas */
(function () {
  var esc = UI.esc;
  var TABS = [['', 'Models', 'sigma'], ['features', 'Feature development', 'sliders'], ['validation', 'Validation', 'grid'], ['metrics', 'Metrics', 'target'], ['compare', 'Compare', 'table']];
  var TASK_ABBR = { forecast: 'F', regression: 'R', binary: 'B', multiclass: 'M', anomaly: 'A', cluster: 'C' };

  function famNo(m) {
    var fam = RI.MODELS.filter(function (x) { return x.family === m.family; });
    return RI.FAMILIES[m.family].n + '.' + (fam.indexOf(m) + 1);
  }
  function tasks(m) {
    return '<span class="at-tasks" title="' + m.tasks.map(function (t) { return RI.TASKS[t]; }).join(', ') + '">' + m.tasks.map(function (t) { return '<span>' + TASK_ABBR[t] + '</span>'; }).join('') + '</span>';
  }
  function bars(m) {
    var b = function (label, v) { return '<span>' + label + '</span><i><b style="width:' + (v / 5 * 100) + '%"></b></i>'; };
    return '<span class="ri-bars" aria-label="accuracy ' + m.power + ', interpretability ' + m.interp + ', speed ' + m.speed + ' (of 5)">' + b('p', m.power) + b('q', m.interp) + b('r', m.speed) + '</span>';
  }
  function plane() {
    var W = 660, H = 400, L = 54, R = 20, T = 18, B = 46;
    var x = function (v) { return L + (v - 1) / 4 * (W - L - R); }, y = function (v) { return T + (5 - v) / 4 * (H - T - B); };
    var g = '';
    for (var k = 1; k <= 5; k++) {
      g += '<line class="gl" x1="' + x(k) + '" y1="' + T + '" x2="' + x(k) + '" y2="' + (H - B) + '"/><line class="gl" x1="' + L + '" y1="' + y(k) + '" x2="' + (W - R) + '" y2="' + y(k) + '"/>' +
        '<text class="tk" x="' + x(k) + '" y="' + (H - B + 15) + '" text-anchor="middle">' + k + '</text><text class="tk" x="' + (L - 8) + '" y="' + (y(k) + 3) + '" text-anchor="end">' + k + '</text>';
    }
    // dots first (nudging exact ties apart), then labels placed greedily where they hit no dot and no other label
    var dots = [];
    RI.MODELS.forEach(function (m) {
      var px = x(m.interp), py = y(m.power);
      while (dots.some(function (d) { return Math.abs(d.x - px) < 7 && Math.abs(d.y - py) < 7; })) { px += 8; }
      dots.push({ m: m, x: px, y: py });
    });
    var boxes = dots.map(function (d) { return [d.x - 6, d.y - 6, d.x + 6, d.y + 6]; });
    var hit = function (b) {
      if (b[0] < L + 2 || b[2] > W - 2 || b[1] < 2 || b[3] > H - B - 2) return true;
      return boxes.some(function (o) { return b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]; });
    };
    var OFFS = [[8, 4, 0], [-8, 4, 1], [0, -9, 2], [0, 17, 2], [8, -8, 0], [-8, -8, 1], [8, 15, 0], [-8, 15, 1], [14, -18, 0], [-14, -18, 1], [14, 26, 0], [-14, 26, 1], [24, 4, 0], [-24, 4, 1]];
    var pts = dots.map(function (d) {
      var w = d.m.short.length * 7.4 + 4, pick = null;
      for (var i = 0; i < OFFS.length && !pick; i++) {
        var o = OFFS[i], lx = d.x + o[0], ly = d.y + o[1];
        var x0 = o[2] === 0 ? lx : o[2] === 1 ? lx - w : lx - w / 2, b = [x0, ly - 9, x0 + w, ly + 2];
        if (!hit(b)) pick = { x: lx, y: ly, a: o[2], b: b, far: Math.abs(o[0]) > 10 || Math.abs(o[1]) > 18 };
      }
      if (!pick) pick = { x: d.x + 8, y: d.y + 4, a: 0, b: [d.x + 8, d.y - 5, d.x + 8 + w, d.y + 6] };
      boxes.push(pick.b);
      var anchor = pick.a === 1 ? ' text-anchor="end"' : pick.a === 2 ? ' text-anchor="middle"' : '';
      return '<a href="#atlas/model/' + d.m.slug + '" class="fam-' + d.m.family + '"><title>' + esc(d.m.name) + '</title>' +
        (pick.far ? '<line x1="' + d.x.toFixed(1) + '" y1="' + d.y.toFixed(1) + '" x2="' + ((pick.b[0] + pick.b[2]) / 2).toFixed(1) + '" y2="' + (pick.y - 4).toFixed(1) + '" stroke="currentColor" stroke-width=".5" opacity=".4"/>' : '') +
        '<circle class="at-dot" cx="' + d.x.toFixed(1) + '" cy="' + d.y.toFixed(1) + '" r="5"/>' +
        '<text x="' + pick.x.toFixed(1) + '" y="' + pick.y.toFixed(1) + '"' + anchor + '>' + esc(d.m.short) + '</text></a>';
    }).join('');
    return '<figure class="at-fig"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Scatter plot of every model by interpretability (x) and accuracy potential (y)">' + g +
      '<line class="ax" x1="' + L + '" y1="' + (H - B) + '" x2="' + (W - R) + '" y2="' + (H - B) + '"/><line class="ax" x1="' + L + '" y1="' + T + '" x2="' + L + '" y2="' + (H - B) + '"/>' +
      '<text class="al" x="' + ((L + W - R) / 2) + '" y="' + (H - 8) + '" text-anchor="middle">interpretability q →</text>' +
      '<text class="al" transform="translate(16 ' + ((T + H - B) / 2) + ') rotate(-90)" text-anchor="middle">accuracy potential p →</text>' + pts + '</svg>' +
      '<figcaption><b>Figure 1.</b> The model plane. There is no free lunch: the top-right corner is empty. Click any point.</figcaption>' +
      '<div class="at-key">' + Object.keys(RI.FAMILIES).map(function (f) { return '<span class="fam-' + f + '"><i></i>' + esc(RI.FAMILIES[f].name) + '</span>'; }).join('') + '</div></figure>';
  }
  function match(q, parts) { q = (q || '').toLowerCase().trim(); return !q || parts.join(' ').toLowerCase().indexOf(q) >= 0; }

  function modelsIndex(q) {
    var html = q ? '' : plane();
    Object.keys(RI.FAMILIES).forEach(function (f) {
      var fam = RI.FAMILIES[f], list = RI.MODELS.filter(function (m) { return m.family === f && match(q, [m.name, m.summary, m.lib, m.slug, fam.name, m.tasks.join(' ')]); });
      if (!list.length) return;
      html += '<section class="at-fam fam-' + f + '"><h2><span class="ri-sec">§' + fam.n + '</span>' + esc(fam.name) + '</h2><p>' + esc(fam.blurb) + '</p><div class="at-rows">' +
        list.map(function (m) {
          return '<a class="at-row" href="#atlas/model/' + m.slug + '"><span class="no">' + famNo(m) + '</span><span><b>' + esc(m.name) + '</b>' + tasks(m) + '</span>' +
            '<span class="sum">' + esc(m.summary) + '</span>' + bars(m) + '</a>';
        }).join('') + '</div></section>';
    });
    return html || '<div class="ui-empty">' + UI.icon('search') + '<h3>No model matches “' + esc(q) + '”</h3></div>';
  }
  function cards(list, kind, q, extra) {
    list = list.filter(function (x) { return match(q, [x.name, x.long || '', x.text, (x.tags || []).join(' '), x.kind || '']); });
    if (!list.length) return '<div class="ui-empty">' + UI.icon('search') + '<h3>Nothing matches “' + esc(q) + '”</h3></div>';
    return '<div class="at-grid">' + list.map(function (x) {
      return '<a class="at-card" href="#atlas/' + kind + '/' + x.slug + '"><div class="ri-meta">' + (x.tags || [x.kind]).map(function (t) { return '<span>' + esc(t) + '</span>'; }).join('') + '</div>' +
        '<h3>' + esc(x.long || x.name) + '</h3><div class="ri-tex">' + RI.tex(x.eq, false) + '</div><p>' + esc(x.text) + '</p>' + (extra ? extra(x) : '') + '</a>';
    }).join('') + '</div>';
  }
  function folds(rows) {
    var cw = 40, ch = 18, gap = 6, W = 70 + rows[0].length * cw, H = rows.length * (ch + gap) + 22;
    var cls = { t: 't', v: 'v', '.': 'u', g: 'g' };
    var s = rows.map(function (r, i) {
      return '<text x="0" y="' + (i * (ch + gap) + 13) + '">fold ' + (i + 1) + '</text>' + r.split('').map(function (c, j) {
        return '<rect class="' + cls[c] + '" x="' + (60 + j * cw) + '" y="' + i * (ch + gap) + '" width="' + (cw - 3) + '" height="' + ch + '" rx="1"/>';
      }).join('');
    }).join('');
    return '<div class="at-folds"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Fold diagram">' + s +
      '<text x="60" y="' + (H - 4) + '">time / rows →</text></svg><div class="at-key" style="margin-top:4px">' +
      '<span><i style="--fc:var(--c-brand)"></i>train</span><span><i style="--fc:var(--c-accent)"></i>validate</span><span><i style="--fc:var(--c-warn)"></i>gap</span></div></div>';
  }
  function compare(sortKey, dir) {
    var cols = [['name', 'Model'], ['family', 'Family'], ['tasks', 'Tasks'], ['power', 'p'], ['interp', 'q'], ['speed', 'r'], ['miss', 'NaN'], ['cat', 'Cat'], ['ivals', 'PI'], ['global', 'Many series'], ['minRows', 'Min rows'], ['lib', 'Library']];
    var list = RI.MODELS.slice().sort(function (a, b) {
      var va = a[sortKey], vb = b[sortKey];
      if (sortKey === 'minRows') { va = RI.ROW_ORDER.indexOf(va); vb = RI.ROW_ORDER.indexOf(vb); }
      if (sortKey === 'tasks') { va = a.tasks.length; vb = b.tasks.length; }
      if (sortKey === 'family') { va = RI.FAMILIES[a.family].n; vb = RI.FAMILIES[b.family].n; }
      if (typeof va === 'boolean') { va = +va; vb = +vb; }
      return (va > vb ? 1 : va < vb ? -1 : a.idx - b.idx) * dir;
    });
    var yn = function (v) { return v ? '<span class="yes">✓</span>' : '<span class="no">·</span>'; };
    return '<p class="muted small">p = accuracy potential, q = interpretability, r = speed (1–5, our judgement). NaN = handles missing values, Cat = native categoricals, PI = prediction intervals. Click a header to sort.</p>' +
      '<div class="at-cmp-wrap"><table class="at-cmp"><thead><tr>' + cols.map(function (c) { return '<th data-sort="' + c[0] + '" class="' + (c[0] === sortKey ? 'on' : '') + '">' + c[1] + (c[0] === sortKey ? (dir > 0 ? ' ↑' : ' ↓') : '') + '</th>'; }).join('') + '</tr></thead><tbody>' +
      list.map(function (m) {
        return '<tr><td><a href="#atlas/model/' + m.slug + '">' + esc(m.name) + '</a></td><td>' + esc(RI.FAMILIES[m.family].name) + '</td><td>' + tasks(m) + '</td>' +
          '<td class="c">' + m.power + '</td><td class="c">' + m.interp + '</td><td class="c">' + m.speed + '</td><td class="c">' + yn(m.miss) + '</td><td class="c">' + yn(m.cat) + '</td><td class="c">' + yn(m.ivals) + '</td><td class="c">' + yn(m.global) + '</td>' +
          '<td class="mono small">' + esc(RI.ROWS[m.minRows]) + '</td><td class="mono small">' + esc(m.lib) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  /* example spec per task, for the "example listing" on a model page */
  var EX = {
    forecast: { columns: [{ name: 'date', type: 'datetime', role: 'time' }, { name: 'store', type: 'categorical', role: 'group' }, { name: 'promo', type: 'boolean', role: 'feature', key: true, known: true }, { name: 'sales', type: 'numeric', role: 'target' }], task: 'forecast', freq: 'D', horizon: 14, file: 'sales.csv' },
    regression: { columns: [{ name: 'city', type: 'categorical', role: 'feature', key: true }, { name: 'sqm', type: 'numeric', role: 'feature', key: true }, { name: 'rooms', type: 'numeric', role: 'feature' }, { name: 'price', type: 'numeric', role: 'target' }], task: 'regression', file: 'homes.csv' },
    binary: { columns: [{ name: 'plan', type: 'categorical', role: 'feature' }, { name: 'tickets', type: 'numeric', role: 'feature', key: true }, { name: 'spend', type: 'numeric', role: 'feature' }, { name: 'churned', type: 'boolean', role: 'target' }], task: 'binary', file: 'customers.csv' },
    multiclass: { columns: [{ name: 'alcohol', type: 'numeric', role: 'feature', key: true }, { name: 'acidity', type: 'numeric', role: 'feature' }, { name: 'band', type: 'categorical', role: 'target' }], task: 'multiclass', file: 'wine.csv' },
    anomaly: { columns: [{ name: 'amount', type: 'numeric', role: 'feature', key: true }, { name: 'merchant', type: 'categorical', role: 'feature' }, { name: 'km_from_home', type: 'numeric', role: 'feature' }, { name: 'is_fraud', type: 'boolean', role: 'target' }], task: 'anomaly', file: 'transactions.csv' },
    anomalyTs: { columns: [{ name: 'timestamp', type: 'datetime', role: 'time' }, { name: 'latency_ms', type: 'numeric', role: 'target' }], task: 'anomaly', freq: 'H', file: 'latency.csv' },
    cluster: { columns: [{ name: 'age', type: 'numeric', role: 'feature' }, { name: 'income', type: 'numeric', role: 'feature', key: true }, { name: 'visits', type: 'numeric', role: 'feature' }, { name: 'channel', type: 'categorical', role: 'feature' }], task: 'cluster', file: 'customers.csv' }
  };

  function modelPage(m) {
    var fam = RI.FAMILIES[m.family], i = m.idx, prev = RI.MODELS[i - 1], next = RI.MODELS[i + 1];
    var cap = function (ok, text) { return '<span class="' + (ok ? 'y' : 'n') + '">' + UI.icon(ok ? 'check' : 'x') + esc(text) + '</span>'; };
    return '<div class="ui-wrap"><div class="at-crumbs"><a href="#atlas">Atlas</a> › <a href="#atlas">§' + fam.n + ' ' + esc(fam.name) + '</a></div>' +
      '<div class="at-entry"><article><span class="ri-listing-no">Model ' + famNo(m) + '</span><h1>' + esc(m.name) + '</h1>' +
      '<div class="ui-row" style="margin-bottom:14px">' + m.tasks.map(function (t) { return '<span class="ui-badge brand">' + esc(RI.TASKS[t]) + '</span>'; }).join('') + '<span class="ui-badge">' + esc(m.lib) + '</span></div>' +
      '<p class="at-lead">' + esc(m.summary) + '</p>' +
      '<div class="ri-thm"><b>Definition ' + famNo(m) + '</b> <i class="nm">(' + esc(m.name) + ')</i><div class="ri-tex">' + RI.tex(m.eq, true) + '</div>' + (m.eqNote ? '<p class="small muted">' + RI.mtext(m.eqNote) + '</p>' : '') + '</div>' +
      (m.obj ? '<div class="ri-thm"><b>Objective.</b><div class="ri-tex">' + RI.tex(m.obj, true) + '</div></div>' : '') +
      '<div class="ri-thm green"><b>Intuition.</b> ' + RI.mtext(m.intuition) + '</div>' +
      '<div class="ri-thm red"><b>When to reach for it.</b> ' + RI.mtext(m.use) + '</div>' +
      '<div class="at-two"><div><h2>Assumptions</h2><ul class="at-list">' + m.assumptions.map(function (a) { return '<li>' + RI.mtext(a) + '</li>'; }).join('') + '</ul></div>' +
      '<div><h2>Complexity</h2><div class="at-cx"><div>train: ' + RI.tex(m.complexity[0]) + '</div><div>predict: ' + RI.tex(m.complexity[1]) + '</div></div></div></div>' +
      '<h2>Hyperparameters</h2><table class="at-params"><thead><tr><th>parameter</th><th>typical range</th><th>effect</th></tr></thead><tbody>' +
      m.params.map(function (p) { return '<tr><td>' + esc(p[0]) + '</td><td>' + esc(p[1]) + '</td><td>' + esc(p[2]) + '</td></tr>'; }).join('') + '</tbody></table>' +
      '<div class="at-two"><div><h2>Strengths</h2><ul class="at-list at-pc">' + m.pros.map(function (a) { return '<li>' + RI.mtext(a) + '</li>'; }).join('') + '</ul></div>' +
      '<div><h2>Weaknesses</h2><ul class="at-list at-cc">' + m.cons.map(function (a) { return '<li>' + RI.mtext(a) + '</li>'; }).join('') + '</ul></div></div>' +
      '<details class="at-example" data-example><summary>' + UI.icon('code') + ' Example listing: ' + esc(m.name) + ' on a small ' + esc(RI.TASKS[m.tasks[0]].toLowerCase()) + ' problem</summary><div data-ex-body></div></details>' +
      '<div class="at-nav">' + (prev ? '<a class="ui-btn ghost" href="#atlas/model/' + prev.slug + '">' + UI.icon('back') + esc(prev.name) + '</a>' : '<span></span>') +
      (next ? '<a class="ui-btn ghost" href="#atlas/model/' + next.slug + '">' + esc(next.name) + UI.icon('arrow') + '</a>' : '') + '</div></article>' +
      '<aside class="at-side"><div class="ui-card"><h4>Profile</h4>' + bars(m) + '<div class="at-caps" style="margin-top:12px">' +
      cap(m.miss, 'Missing values') + cap(m.cat, 'Native categoricals') + cap(m.ivals, 'Prediction intervals') + cap(m.global, 'One model, many series') + cap(!m.scale, 'No scaling needed') + '</div>' +
      '<p class="small muted" style="margin:10px 0 0">Data: ' + ({ xs: 'works from a few hundred rows', s: 'wants 1k+ rows', m: 'wants 10k+ rows', l: 'wants 100k+ rows' }[m.minRows] || '') +
        (m.maxRows !== 'xl' ? '; slow beyond ' + { s: '10k', m: '100k', l: '1M' }[m.maxRows] + ' rows' : '') + '.</p></div>' +
      '<button class="ui-btn primary block" data-use="' + m.slug + '">' + UI.icon('flask') + 'Use it in the Lab</button>' +
      casebook(m) +
      (m.related.length ? '<div class="ui-card"><h4>Related</h4><div class="ui-stack" style="font-size:.95rem">' + m.related.map(function (s) { var r = RI.MODEL[s]; return r ? '<div><a href="#atlas/model/' + s + '">' + esc(r.name) + '</a></div>' : ''; }).join('') + '</div></div>' : '') +
      '</aside></div></div>';
  }
  /* The Casebook situations that list this model (best-placed first) */
  function casebook(m) {
    var hits = RI.casesFor ? RI.casesFor(m.slug) : [];
    if (!hits.length) return '';
    return '<div class="ui-card at-cases"><h4>In the Casebook</h4><div class="ui-stack" style="font-size:.92rem">' + hits.slice(0, 6).map(function (h) {
      return '<a href="#cases/' + h.c.ind + '/' + h.c.id + '"><span class="no">' + h.c.no + '</span>' + esc(h.c.name) + (h.rank === 0 ? ' <span class="top" title="First choice in this case">1st</span>' : '') + '</a>';
    }).join('') + '</div>' + '<a class="small" href="#cases/model/' + m.slug + '">' + (hits.length > 6 ? 'All ' + hits.length + ' cases' : 'Show them in the Casebook') + ' ' + UI.icon('arrow') + '</a></div>';
  }
  function simplePage(kind, x, list) {
    var i = list.indexOf(x), prev = list[i - 1], next = list[i + 1];
    var chapter = { feature: ['features', 'Feature development'], validation: ['validation', 'Validation'], metric: ['metrics', 'Metrics'] }[kind];
    return '<div class="ui-wrap ui-narrow"><div class="at-crumbs"><a href="#atlas">Atlas</a> › <a href="#atlas/' + chapter[0] + '">' + chapter[1] + '</a></div>' +
      '<div class="ri-meta" style="margin-bottom:6px">' + (x.tags || [x.kind]).map(function (t) { return '<span>' + esc(t) + '</span>'; }).join('') + '</div>' +
      '<h1>' + esc(x.long || x.name) + '</h1>' +
      '<div class="ri-thm"><b>' + (kind === 'metric' ? 'Definition.' : kind === 'validation' ? 'Scheme.' : 'Formula.') + '</b><div class="ri-tex">' + RI.tex(x.eq, true) + '</div></div>' +
      '<p class="at-lead">' + RI.mtext(x.text) + '</p>' +
      (x.folds ? folds(x.folds) : '') +
      (x.warn ? '<div class="ri-thm red" style="margin-top:18px"><b>Caution.</b> ' + RI.mtext(x.warn) + '</div>' : '') +
      (x.code ? '<h2 style="font-size:1.15rem;margin-top:22px">In Python</h2><div class="ri-code"><pre>' + RI.highlight(x.code) + '</pre></div>' : '') +
      '<div class="at-nav">' + (prev ? '<a class="ui-btn ghost" href="#atlas/' + kind + '/' + prev.slug + '">' + UI.icon('back') + esc(prev.long || prev.name) + '</a>' : '<span></span>') +
      (next ? '<a class="ui-btn ghost" href="#atlas/' + kind + '/' + next.slug + '">' + esc(next.long || next.name) + UI.icon('arrow') + '</a>' : '') + '</div></div>';
  }

  UI.page('atlas', { title: 'The Atlas', nav: 'Atlas', icon: 'book', order: 20 }, function (view, ctx) {
    var a = ctx.args, sortKey = 'family', dir = 1, q = '';
    function entry() {
      var kind = a[0], slug = a[1], x;
      if (kind === 'model' && (x = RI.MODEL[slug])) { document.title = x.name + ' · Atlas · RoboIntern'; return modelPage(x); }
      var lists = { feature: RI.FEATURES, validation: RI.VALIDATION, metric: RI.METRICS }[kind];
      if (lists && (x = lists.filter(function (y) { return y.slug === slug; })[0])) { document.title = (x.long || x.name) + ' · Atlas · RoboIntern'; return simplePage(kind, x, lists); }
      return null;
    }
    function draw() {
      var html = a.length === 2 ? entry() : null;
      if (html) { view.innerHTML = html; return; }
      var tab = TABS.some(function (t) { return t[0] === a[0]; }) ? a[0] : '';
      var counts = { '': RI.MODELS.length, features: RI.FEATURES.length, validation: RI.VALIDATION.length, metrics: RI.METRICS.length, compare: '' };
      view.innerHTML = '<div class="ui-wrap"><div class="at-head"><div><h1>The Atlas: every strategy, with the maths</h1>' +
        '<p class="muted">' + RI.MODELS.length + ' models, ' + RI.FEATURES.length + ' feature recipes, ' + RI.VALIDATION.length + ' validation schemes and ' + RI.METRICS.length + ' metrics for predicting from historical data.</p></div>' +
        (tab !== 'compare' ? '<input type="search" class="at-search" data-q placeholder="search the atlas…" value="' + esc(q) + '" aria-label="Search the atlas">' : '') + '</div>' +
        '<nav class="ui-tabs">' + TABS.map(function (t) { return '<a href="#atlas' + (t[0] ? '/' + t[0] : '') + '" class="' + (t[0] === tab ? 'on' : '') + '">' + UI.icon(t[2]) + t[1] + (counts[t[0]] ? ' <span class="count">' + counts[t[0]] + '</span>' : '') + '</a>'; }).join('') + '</nav>' +
        '<div data-body></div></div>';
      body(tab);
    }
    function body(tab) {
      var b = view.querySelector('[data-body]');
      if (tab === '') b.innerHTML = modelsIndex(q);
      else if (tab === 'features') b.innerHTML = cards(RI.FEATURES, 'feature', q);
      else if (tab === 'validation') b.innerHTML = cards(RI.VALIDATION, 'validation', q);
      else if (tab === 'metrics') b.innerHTML = cards(RI.METRICS, 'metric', q);
      else b.innerHTML = compare(sortKey, dir);
    }
    view.addEventListener('input', function (e) {
      if (e.target.matches('[data-q]')) { q = e.target.value; body(TABS.some(function (t) { return t[0] === a[0]; }) ? a[0] : ''); }
    });
    view.addEventListener('click', function (e) {
      var s = e.target.closest('[data-sort]');
      if (s) { var k = s.getAttribute('data-sort'); dir = k === sortKey ? -dir : (['power', 'interp', 'speed', 'miss', 'cat', 'ivals', 'global'].indexOf(k) >= 0 ? -1 : 1); sortKey = k; body('compare'); return; }
      var u = e.target.closest('[data-use]');
      if (u) { UI.store.set('lab-pick', u.getAttribute('data-use')); UI.go('lab'); UI.toast('Picked ' + RI.MODEL[u.getAttribute('data-use')].name + ' in the Lab'); }
    });
    view.addEventListener('toggle', function (e) {
      var d = e.target;
      if (!d.matches || !d.matches('[data-example]') || !d.open) return;
      var box = d.querySelector('[data-ex-body]');
      if (box.innerHTML) return;
      var m = RI.MODEL[a[1]], ex = EX[m.tmpl === 'anomts' ? 'anomalyTs' : m.tasks[0]], files = RI.generate(ex, m.slug), cur = 'train';
      var paint = function () { box.innerHTML = '<p class="small muted">Columns: ' + ex.columns.map(function (c) { return '<code>' + esc(c.name) + '</code>'; }).join(' ') + '. Open the Lab to write one for your own data.</p>' + RI.codeBlock(files, cur); };
      paint();
      RI.wireCode(box, function () { return files; }, function (k) { cur = k; paint(); }, function () { return { title: m.name + ' example', model: m.slug, spec: ex }; });
    }, true);
    draw();
    RI.whenTex(draw);
  });
})();
/* ---- cases */
(function () {
  var esc = UI.esc;

  function caseUrl(c) { return '#cases/' + c.ind + '/' + c.id; }
  function shortModels(c) { return c.models.map(function (m) { return '<span title="' + esc(RI.MODEL[m[0]].name) + '">' + esc(RI.MODEL[m[0]].short) + '</span>'; }).join(''); }
  function match(c, q) {
    q = (q || '').toLowerCase().trim();
    if (!q) return true;
    var hay = [c.no, c.name, c.q, RI.INDUSTRY[c.ind].name, RI.SHAPES[c.shape].name, c.act]
      .concat(c.sig.map(function (s) { return s[1] + ' ' + s[2] + ' ' + s[0]; }))
      .concat(c.models.map(function (m) { return RI.MODEL[m[0]].name; })).join(' ').toLowerCase();
    return q.split(/\s+/).every(function (w) { return hay.indexOf(w) >= 0; });
  }

  /* ---------------------------------------------------------------- Figure 2: industries x shapes */
  function matrix(f) {
    var max = 1, count = {};
    RI.CASES.forEach(function (c) { var k = c.ind + ':' + c.shape; count[k] = (count[k] || 0) + 1; if (count[k] > max) max = count[k]; });
    var head = '<tr><th></th>' + RI.SHAPE_ORDER.map(function (s) {
      return '<th scope="col"><button type="button" data-shape="' + s + '" class="' + (f.shape === s && !f.ind ? 'on' : '') + '" title="' + esc(RI.SHAPES[s].blurb) + '">' + esc(RI.SHAPES[s].name) + '</button></th>';
    }).join('') + '<th class="tot" scope="col">n</th></tr>';
    var body = RI.INDUSTRIES.map(function (ind) {
      var n = 0;
      var cells = RI.SHAPE_ORDER.map(function (s) {
        var k = count[ind.key + ':' + s] || 0; n += k;
        if (!k) return '<td><span class="z">·</span></td>';
        var on = f.ind === ind.key && f.shape === s;
        return '<td><button type="button" data-cell="' + ind.key + ':' + s + '" class="' + (on ? 'on' : '') + '" style="--a:' + Math.round(10 + 34 * k / max) + '%" ' +
          'aria-label="' + esc(ind.name + ', ' + RI.SHAPES[s].name + ': ' + k) + '">' + k + '</button></td>';
      }).join('');
      return '<tr><th scope="row"><button type="button" data-ind="' + ind.key + '" class="' + (f.ind === ind.key && !f.shape ? 'on' : '') + '">' + UI.icon(ind.icon) + esc(ind.name) + '</button></th>' + cells + '<td class="tot">' + n + '</td></tr>';
    }).join('');
    return '<figure class="cs-fig"><div class="cs-mx-wrap"><table class="cs-mx"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>' +
      '<figcaption><b>Figure 2.</b> ' + RI.CASES.length + ' situations in ' + RI.INDUSTRIES.length + ' industries, and only ' + RI.SHAPE_ORDER.length +
      ' shapes of prediction. Every industry reuses the same columns: the list is long, but it is finite. Click a number, an industry or a shape.</figcaption></figure>';
  }

  function list(f) {
    var cases = RI.CASES.filter(function (c) {
      return (!f.ind || c.ind === f.ind) && (!f.shape || c.shape === f.shape) && match(c, f.q) &&
        (!f.model || c.models.some(function (m) { return m[0] === f.model; }));
    });
    if (f.model) {  // best-placed first
      var rank = function (c) { for (var i = 0; i < c.models.length; i++) if (c.models[i][0] === f.model) return i; return 9; };
      cases.sort(function (a, b) { return rank(a) - rank(b) || a.idx - b.idx; });
    }
    if (!cases.length) return '<div class="ui-empty">' + UI.icon('search') + '<h3>No case matches' + (f.q ? ' “' + esc(f.q) + '”' : '') + '</h3><p class="muted">Try fewer words, or <button type="button" class="ui-btn sm ghost" data-clear>clear the filters</button></p></div>';
    var row = function (c) {
      return '<a class="cs-row" href="' + caseUrl(c) + '"><span class="no">' + c.no + '</span><span><b>' + esc(c.name) + '</b><span class="cs-tag">' + esc(RI.SHAPES[c.shape].name) + '</span></span>' +
        '<span class="q">' + esc(c.q) + '</span><span class="cs-mods">' + shortModels(c) + '</span></a>';
    };
    if (f.model) return '<div class="cs-rows">' + cases.map(row).join('') + '</div>';
    return RI.INDUSTRIES.map(function (ind) {
      var mine = cases.filter(function (c) { return c.ind === ind.key; });
      if (!mine.length) return '';
      return '<section class="cs-ind"><h2>' + UI.icon(ind.icon) + '<span class="ri-sec">§' + ind.letter + '</span>' + esc(ind.name) + '</h2><p>' + esc(ind.blurb) + '</p>' +
        '<div class="cs-rows">' + mine.map(row).join('') + '</div></section>';
    }).join('');
  }

  function limits() {
    return '<section class="cs-limits"><div class="ri-thm red"><b>Outside this book.</b> Five kinds of work look like "machine learning" but aren\'t prediction from a table. They often use these predictions, or feed them a column.' +
      '<ul>' + RI.CASE_LIMITS.map(function (l) { return '<li><b>' + esc(l[0]) + '.</b> ' + esc(l[1]) + '</li>'; }).join('') + '</ul></div></section>';
  }

  /* ---------------------------------------------------------------- one case */
  var TYPE_WORD = { numeric: 'number', categorical: 'category', datetime: 'date', boolean: 'true / false', text: 'text', id: 'id' };
  var ROLE_GLYPH = { feature: 'x', target: 'y', time: 't', group: 'g', ignore: '∅' };
  function colRows(c, cols) {
    return '<table class="cs-cols"><tbody>' + cols.map(function (s) {
      var x = RI.caseColumn(s), notes = [];
      if (x.key) notes.push('<span class="k">★ key driver</span>');
      if (x.known && c.task === 'forecast') notes.push('<span class="kn">known ahead</span>');
      if (x.role === 'target') notes.push('<span class="small muted">' + (c.task === 'anomaly' ? 'the label, only to measure' : 'what you predict') + '</span>');
      if (x.role === 'ignore') notes.push('<span class="small muted">row id, not a feature</span>');
      return '<tr><td><span class="ri-role ' + x.role + '">' + ROLE_GLYPH[x.role] + '</span></td><td class="nm">' + esc(x.name) + '</td><td class="ty">' + TYPE_WORD[x.type] + '</td><td>' + notes.join(' ') + '</td></tr>';
    }).join('') + '</tbody></table>';
  }

  function casePage(c, view) {
    var ind = RI.INDUSTRY[c.ind], shape = RI.SHAPES[c.shape], off = {}, pick = c.models[0][0], cur = 'train', files = null;
    var i = c.idx, prev = RI.CASES[i - 1], next = RI.CASES[i + 1];
    var same = RI.CASES.filter(function (x) { return x.shape === c.shape && x.ind !== c.ind; }).slice(0, 7);
    function spec() { return RI.caseSpec(c, off); }
    function gen() { files = RI.generate(spec(), pick, c.name); return files; }
    function used(s) { return files && files.train.indexOf('"' + s[0].split('|')[0] + '"') >= 0; }
    function sigsHtml() {
      if (!c.sig.length) return '';
      var m = RI.MODEL[pick];
      return c.sig.map(function (s, k) {
        var x = RI.caseColumn(s[0]), on = !off[k];
        var tag = c.task === 'forecast' ? (x.known ? 'known ahead' : 'past only: lagged by the horizon') : TYPE_WORD[x.type];
        return '<label class="cs-sig' + (on ? '' : ' off') + '"><input type="checkbox" data-sig="' + k + '"' + (on ? ' checked' : '') + ' aria-label="Use ' + esc(s[1]) + '">' +
          '<div class="cs-sig-body"><b>' + esc(s[1]) + '</b><span class="src">' + esc(s[2]) + '</span><p>' + esc(s[3]) + '</p>' +
          '<div class="meta"><code>' + esc(x.name) + '</code><span>' + esc(tag) + '</span>' + (x.key ? '<span>★ key driver</span>' : '') +
          (on && !used(s) ? '<span class="ign">' + esc(m.short) + ' can\'t use it: pick a model that reads drivers</span>' : '') + '</div></div></label>';
      }).join('');
    }
    function modelsHtml() {
      return c.models.map(function (mm, r) {
        var m = RI.MODEL[mm[0]];
        return '<div role="button" tabindex="0" class="cs-model' + (mm[0] === pick ? ' on' : '') + '" data-pick="' + m.slug + '" aria-pressed="' + (mm[0] === pick) + '"><span class="rk">' + (r + 1) + '</span>' +
          '<span><b>' + esc(m.name) + '</b><span class="fam">' + esc(RI.FAMILIES[m.family].name) + '</span></span>' +
          '<a href="#atlas/model/' + m.slug + '" data-atlas>Atlas ' + UI.icon('arrow') + '</a><span class="why">' + esc(mm[1]) + '</span></div>';
      }).join('');
    }
    function glanceHtml() {
      var on = c.sig.filter(function (s, k) { return !off[k]; }).length, sp = spec();
      var f = RI.FREQ[sp.freq];
      return '<dl class="cs-glance"><dt>shape</dt><dd><a href="#cases/shape/' + c.shape + '">' + esc(shape.name) + '</a></dd><dt>task</dt><dd>' + esc(RI.TASKS[c.task]) + '</dd>' +
        (c.task === 'forecast' ? '<dt>step</dt><dd>' + esc(f.name) + '</dd><dt>horizon</dt><dd>' + sp.horizon + ' ' + esc(f.unit) + '</dd>' : '') +
        '<dt>data</dt><dd>' + esc(RI.ROWS[c.rows]) + '</dd><dt>columns</dt><dd>' + sp.columns.length + ' (' + on + ' of ' + c.sig.length + ' signals)</dd>' +
        '<dt>model</dt><dd>' + esc(RI.MODEL[pick].name) + '</dd></dl>';
    }
    function codeHtml() {
      return RI.codeBlock(files, cur);
    }
    function refresh() {
      gen();
      view.querySelector('[data-sigs]').innerHTML = sigsHtml();
      view.querySelector('[data-models]').innerHTML = modelsHtml();
      view.querySelector('[data-glance]').innerHTML = glanceHtml();
      view.querySelector('[data-codebox]').innerHTML = codeHtml();
      view.querySelector('[data-code-title]').textContent = RI.MODEL[pick].name;
    }
    function draw() {
      gen();
      var sp = spec();
      view.innerHTML = '<div class="ui-wrap"><div class="cs-crumbs"><a href="#cases">Casebook</a> › <a href="#cases/' + c.ind + '">§' + ind.letter + ' ' + esc(ind.name) + '</a></div>' +
        '<div class="cs-entry"><article><span class="ri-listing-no">Case ' + c.no + ' · ' + esc(shape.name) + '</span><h1>' + esc(c.name) + '</h1>' +
        '<div class="ui-row"><span class="ui-badge brand">' + esc(RI.TASKS[c.task]) + '</span><span class="ui-badge">' + UI.icon(ind.icon) + esc(ind.name) + '</span></div>' +
        '<p class="cs-lead">' + esc(c.q) + '</p>' +
        '<div class="ri-thm"><b>Setting.</b> <i class="nm">(' + esc(shape.blurb) + ')</i><div class="ri-tex">' + RI.tex(RI.notation(sp), true) + '</div></div>' +
        '<h2><span class="ri-sec">§1</span>The history you already have</h2><p class="cs-sub">Columns most teams can export today. Their names are suggestions: paste your own header in the Lab.</p>' + colRows(c, c.cols) +
        '<h2><span class="ri-sec">§2</span>Beyond history: signals that sharpen it</h2><p class="cs-sub">History says what happened. These say what is coming, or why. Untick the ones you can\'t get yet; the code in §6 follows.</p>' +
        '<div class="cs-sigs" data-sigs>' + sigsHtml() + '</div>' +
        '<h2><span class="ri-sec">§3</span>The models, best first</h2><p class="cs-sub">Pick one to write its code. The Lab ranks all of them with a visible formula.</p><div class="cs-models" data-models>' + modelsHtml() + '</div>' +
        '<h2><span class="ri-sec">§4</span>From prediction to decision</h2>' +
        '<div class="ri-thm green"><b>Decision rule.</b> ' + RI.mtext(c.act) + (c.tex ? '<div class="ri-tex">' + RI.tex(c.tex, true) + '</div>' : '') + '</div>' +
        (c.watch ? '<div class="ri-thm red"><b>Caution.</b> ' + RI.mtext(c.watch) + '</div>' : '') +
        '<h2><span class="ri-sec">§5</span>Build it and check it</h2><div class="cs-checks">' +
        '<div class="ui-card"><h4>Features</h4><div class="cs-links">' + c.feats.map(function (s) { var x = RI.FEATURES.filter(function (y) { return y.slug === s; })[0]; return '<a href="#atlas/feature/' + s + '">' + esc(x.name) + '</a>'; }).join('') + '</div></div>' +
        '<div class="ui-card"><h4>Validation</h4><div class="cs-links">' + (c.val ? '<a href="#atlas/validation/' + c.val + '">' + esc(RI.VALIDATION.filter(function (y) { return y.slug === c.val; })[0].name) + '</a>' : '<span class="small muted">No target to validate against: check the groups are stable across seeds and samples.</span>') + '</div></div>' +
        '<div class="ui-card"><h4>Metrics</h4><div class="cs-links">' + c.metrics.map(function (s) { var x = RI.METRICS.filter(function (y) { return y.slug === s; })[0]; return '<a href="#atlas/metric/' + s + '">' + esc(x.name) + '</a>'; }).join('') + '</div></div></div>' +
        '<div class="cs-codehead"><h2><span class="ri-sec">§6</span>The code: <span data-code-title>' + esc(RI.MODEL[pick].name) + '</span></h2>' +
        '<button type="button" class="ui-btn sm" data-lab>' + UI.icon('flask') + 'Open in the Lab</button></div>' +
        '<p class="cs-sub small muted">train.py, predict.py and requirements.txt for this case\'s columns. Rename the columns to yours, or open it in the Lab and paste your header.</p>' +
        '<div data-codebox>' + codeHtml() + '</div>' +
        '<div class="cs-nav">' + (prev ? '<a class="ui-btn ghost" href="' + caseUrl(prev) + '">' + UI.icon('back') + prev.no + ' ' + esc(prev.name) + '</a>' : '<span></span>') +
        (next ? '<a class="ui-btn ghost" href="' + caseUrl(next) + '">' + next.no + ' ' + esc(next.name) + UI.icon('arrow') + '</a>' : '') + '</div></article>' +
        '<aside class="cs-side"><div class="ui-card"><h4>At a glance</h4><div data-glance>' + glanceHtml() + '</div></div>' +
        '<button type="button" class="ui-btn primary block" data-lab>' + UI.icon('flask') + 'Open in the Lab</button>' +
        (same.length ? '<div class="ui-card cs-same"><h4>Same shape, other industries</h4>' + same.map(function (x) { return '<a href="' + caseUrl(x) + '"><span class="no">' + x.no + '</span>' + esc(x.name) + '</a>'; }).join('') +
          '<p class="small muted" style="margin:8px 0 0">Same maths, different columns.</p></div>' : '') +
        '</aside></div></div>';
    }
    view.addEventListener('keydown', function (e) {
      var p = e.target.closest && e.target.closest('[data-pick]');
      if (p && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pick = p.getAttribute('data-pick'); refresh(); view.querySelector('[data-pick="' + pick + '"]').focus(); }
    });
    view.addEventListener('change', function (e) {
      var s = e.target.closest('[data-sig]');
      if (!s) return;
      var k = +s.getAttribute('data-sig');
      if (s.checked) delete off[k]; else off[k] = true;
      refresh();
    });
    view.addEventListener('click', function (e) {
      if (e.target.closest('[data-atlas]')) return;  // the link inside a model row
      var p = e.target.closest('[data-pick]');
      if (p) { pick = p.getAttribute('data-pick'); refresh(); return; }
      if (e.target.closest('[data-lab]')) {
        UI.store.set('lab-load', { spec: spec(), model: pick });
        UI.go('lab');
        UI.toast('Case ' + c.no + ' is in the Lab: paste your own header to swap the columns');
      }
    });
    RI.wireCode(view, function () { return files; }, function (k) { cur = k; view.querySelector('[data-codebox]').innerHTML = codeHtml(); },
      function () { return { title: c.name + ' (' + RI.MODEL[pick].name + ')', model: pick, spec: spec(), notes: c.q }; });
    draw();
    RI.whenTex(function () { var y = window.scrollY; draw(); window.scrollTo(0, y); });
  }

  UI.page('cases', { title: 'The Casebook', nav: 'Cases', icon: 'cases', order: 15 }, function (view, ctx) {
    var a = ctx.args;
    if (a.length === 2 && RI.INDUSTRY[a[0]] && RI.CASE[a[1]] && RI.CASE[a[1]].ind === a[0]) {
      var c = RI.CASE[a[1]];
      document.title = c.name + ' · Casebook · RoboIntern';
      casePage(c, view);
      return;
    }
    var f = { ind: RI.INDUSTRY[a[0]] ? a[0] : null, shape: a[0] === 'shape' && RI.SHAPES[a[1]] ? a[1] : null, model: a[0] === 'model' && RI.MODEL[a[1]] ? a[1] : null, q: '' };
    function filterLine() {
      var bits = [];
      if (f.ind) bits.push(esc(RI.INDUSTRY[f.ind].name));
      if (f.shape) bits.push(esc(RI.SHAPES[f.shape].name));
      if (f.model) bits.push('cases that use ' + esc(RI.MODEL[f.model].name));
      if (!bits.length) return '';
      return '<div class="cs-filter">Showing <b>' + bits.join(' × ') + '</b>' + (f.shape && !f.ind ? '<span>: ' + esc(RI.SHAPES[f.shape].blurb) + '</span>' : '') +
        '<button type="button" class="ui-btn sm ghost" data-clear>' + UI.icon('x') + 'Show all</button>' +
        (f.model ? '<a class="ui-btn sm ghost" href="#atlas/model/' + f.model + '">' + UI.icon('book') + 'The model in the Atlas</a>' : '') + '</div>';
    }
    function chips() {
      return '<div class="cs-chips"><button type="button" class="cs-chip' + (!f.ind && !f.shape && !f.model ? ' on' : '') + '" data-clear>All <span class="n">' + RI.CASES.length + '</span></button>' +
        RI.INDUSTRIES.map(function (ind) {
          var n = RI.CASES.filter(function (c) { return c.ind === ind.key; }).length;
          return '<button type="button" class="cs-chip' + (f.ind === ind.key ? ' on' : '') + '" data-ind="' + ind.key + '">' + UI.icon(ind.icon) + esc(ind.name) + ' <span class="n">' + n + '</span></button>';
        }).join('') + '</div>';
    }
    function draw() {
      view.innerHTML = '<div class="ui-wrap"><div class="cs-head"><div><h1>The Casebook: every situation, linked to its model</h1>' +
        '<p class="muted">' + RI.CASES.length + ' business situations from ' + RI.INDUSTRIES.length + ' industries. Each one names the data you already have, the signals that would sharpen it, ' +
        'the models that fit, how the prediction becomes a decision, and the Python.</p></div>' +
        '<input type="search" class="cs-search" data-q placeholder="safety stock, weather, churn…" value="' + esc(f.q) + '" aria-label="Search the casebook"></div>' +
        '<div data-top>' + top() + '</div><div data-list>' + list(f) + '</div>' + (f.model ? '' : limits()) + '</div>';
    }
    function top() { return (f.model ? '' : matrix(f) + chips()) + filterLine(); }
    function redraw(scroll) {
      view.querySelector('[data-top]').innerHTML = top();
      view.querySelector('[data-list]').innerHTML = list(f);
      if (scroll) { var el = view.querySelector('[data-list]'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
    }
    view.addEventListener('input', function (e) { if (e.target.matches('[data-q]')) { f.q = e.target.value; view.querySelector('[data-list]').innerHTML = list(f); } });
    view.addEventListener('click', function (e) {
      var t;
      if ((t = e.target.closest('[data-cell]'))) { var p = t.getAttribute('data-cell').split(':'); f.ind = p[0]; f.shape = p[1]; f.model = null; redraw(true); return; }
      if ((t = e.target.closest('[data-ind]'))) { f.ind = f.ind === t.getAttribute('data-ind') && !f.shape ? null : t.getAttribute('data-ind'); f.shape = null; f.model = null; redraw(false); return; }
      if ((t = e.target.closest('[data-shape]'))) { f.shape = f.shape === t.getAttribute('data-shape') && !f.ind ? null : t.getAttribute('data-shape'); f.ind = null; f.model = null; redraw(false); return; }
      if (e.target.closest('[data-clear]')) {
        var hadModel = !!f.model;
        f.ind = f.shape = f.model = null; f.q = '';
        var s = view.querySelector('[data-q]'); if (s) s.value = '';
        if (hadModel) { draw(); return; }
        redraw(false);
      }
    });
    draw();
  });
})();
