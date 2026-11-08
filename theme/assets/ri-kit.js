/* ri-kit.js: the small window.UI helpers RoboIntern's JavaScript engine (ri-engine.js) and its three screens
   (ri-screens.js: the Lab, the Atlas, the Casebook) were written against, now that the app itself is Python Forms.
   Loaded after app-kit.js (UI.esc, UI.store, UI.icon, UI.ICONS, light/dark).

   Server:   UI.api(fn, ...args) / UI.apiQuiet go through window.RI_BRIDGE, a Python function set by client_code/ri.py
             (anvil.server.call there). A reply {ok: false, error} rejects (err.expected); errors nobody catches
             become a toast.
   Host:     RI.host = Python functions (client_code/ri.py): toast, confirm, remember_after, save_listing,
             save_dataset, go. UI.toast / UI.confirm use them, so the screens show the same notifications and
             dialogs as the Forms.
   Screens:  UI.page(name, opts, mount) keeps a screen in UI.pages; Components/Screen mounts it.
   Python:   RI.py.* hand the engine's data to Python as JSON text (models, tasks, samples, the Casebook teaser,
             a listing's column table), so the Forms never parse JavaScript objects. */
(function () {
  'use strict';
  var UI = window.UI = window.UI || {};
  var RI = window.RI = window.RI || {};
  UI.pages = UI.pages || {};
  UI.me = UI.me || null;
  RI.host = RI.host || {};

  UI.page = function (name, opts, mount) {
    if (typeof opts === 'function') { mount = opts; opts = {}; }
    opts.name = name; opts.mount = mount;
    UI.pages[name] = opts;
  };
  /* Mount a screen into el. Returns {ready: Promise, destroy()}. */
  UI.mountScreen = function (name, el, args) {
    var p = UI.pages[name];
    if (!p) throw new Error('No screen called ' + name);
    var out = p.mount(el, { name: name, args: args || [], me: UI.me, go: UI.go, api: UI.api, page: p });
    var ready = out && typeof out.then === 'function' ? out : (out && out.ready) || Promise.resolve();
    ready = Promise.resolve(ready).then(function (v) { window.UI_READY = true; return v; }, function (e) { window.UI_READY = true; throw e; });
    return { ready: ready, destroy: (out && out.destroy) || function () {} };
  };

  UI.initials = function (name) {
    var p = String(name || '?').trim().split(/\s+/);
    return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
  };
  UI.fmtDate = function (iso, opts) {
    if (!iso) return '';
    var d = iso.length <= 10 ? new Date(iso + 'T12:00:00') : new Date(iso);
    return d.toLocaleDateString(undefined, opts || { day: 'numeric', month: 'short', year: 'numeric' });
  };
  UI.fmtDateTime = function (iso) {
    return iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  };
  UI.ago = function (iso) {
    if (!iso) return '';
    var s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return 'just now';
    var steps = [[60, 'minute'], [24, 'hour'], [7, 'day'], [4.35, 'week'], [12, 'month'], [Infinity, 'year']], n = s / 60;
    for (var i = 0; i < steps.length; i++) {
      if (n < steps[i][0]) { n = Math.floor(n); return UI.plural(n, steps[i][1]) + ' ago'; }
      n = n / steps[i][0];
    }
    return '';
  };
  UI.formData = function (form) {
    var out = {};
    Array.prototype.forEach.call(form.elements, function (el) {
      if (!el.name || el.disabled) return;
      if (el.type === 'checkbox') out[el.name] = el.checked;
      else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
      else out[el.name] = el.value;
    });
    return out;
  };
  UI.busy = function (btn, promise) {
    if (!btn) return promise;
    btn.disabled = true; btn.classList.add('is-busy');
    var done = function () { btn.disabled = false; btn.classList.remove('is-busy'); };
    promise.then(done, done);
    return promise;
  };
  UI.hashFor = function (name) {
    var args = Array.prototype.slice.call(arguments, 1).filter(function (a) { return a != null && a !== ''; });
    return '#' + [name].concat(args.map(encodeURIComponent)).join('/');
  };
  UI.go = function () {
    var h = UI.hashFor.apply(null, arguments);
    if (location.hash === h && RI.host.go) RI.host.go(h); else location.hash = h;
  };
  /* The screens wrote `UI.after = '#lab'` (where to go after signing in): that is the router's job now. */
  Object.defineProperty(UI, 'after', {
    configurable: true,
    get: function () { return null; },
    set: function (v) { if (v && RI.host.remember_after) RI.host.remember_after(String(v)); }
  });

  /* ------------------------------------------------------------------ toasts and dialogs */
  UI.toast = function (msg, kind) {
    if (RI.host.toast) { try { RI.host.toast(String(msg), kind || ''); return; } catch (e) { /* fall through */ } }
    window.console && console.log('toast:', msg);
  };
  UI.confirm = function (o) {
    o = typeof o === 'string' ? { title: o } : (o || {});
    if (RI.host.confirm) return Promise.resolve(RI.host.confirm(JSON.stringify(o))).then(function (v) { return !!v; });
    return Promise.resolve(window.confirm(o.title || 'Are you sure?'));
  };

  /* ------------------------------------------------------------------ the server, through Python */
  function send(payload) {
    if (!window.RI_BRIDGE) return Promise.reject(new Error('The app is still starting.'));
    var out;
    try { out = window.RI_BRIDGE(JSON.stringify(payload || {})); } catch (e) { return Promise.reject(e); }
    return Promise.resolve(out).then(function (r) {
      r = typeof r === 'string' ? JSON.parse(r) : (r || {});
      if (r.error) {
        var err = new Error(r.error); err.uiApi = true; err.denied = !!r.denied;
        if (r.detail) console.error(payload && payload.fn, r.detail);
        if (r.reload) setTimeout(function () { location.reload(); }, 2500);
        throw err;
      }
      var res = r.result;
      if (res && typeof res === 'object' && res.ok === false) {
        var e2 = new Error(res.error || 'That didn\'t work.'); e2.uiApi = true; e2.expected = true; e2.result = res;
        throw e2;
      }
      return res;
    });
  }
  UI.api = function (fn) { return send({ fn: fn, args: Array.prototype.slice.call(arguments, 1), quiet: false }); };
  UI.apiQuiet = function (fn) { return send({ fn: fn, args: Array.prototype.slice.call(arguments, 1), quiet: true }); };
  window.addEventListener('unhandledrejection', function (e) {
    if (e.reason && e.reason.uiApi) { e.preventDefault(); UI.toast(e.reason.message, 'error'); }
  });

  /* [data-go="page/arg"] inside screen markup (buttons, not links): go there. Links already have an href. */
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-go]') : null;
    if (!t || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    e.preventDefault();
    UI.go.apply(null, t.getAttribute('data-go').split('/'));
  });

  /* ------------------------------------------------------------------ the engine's data, as JSON text for Python */
  function modelLite(m) { return { slug: m.slug, name: m.name, summary: m.summary || '', tmpl: m.tmpl || '' }; }
  RI.py = {
    meta: function () {
      var models = {};
      RI.MODELS.forEach(function (m) { models[m.slug] = modelLite(m); });
      return JSON.stringify({
        counts: { models: RI.MODELS.length, cases: RI.CASES.length, industries: RI.INDUSTRIES.length, shapes: RI.SHAPE_ORDER.length },
        tasks: RI.TASKS, task_short: RI.TASK_SHORT, models: models,
        industries: RI.INDUSTRIES.map(function (ind) {
          return { key: ind.key, name: ind.name, icon: ind.icon, n: RI.CASES.filter(function (c) { return c.ind === ind.key; }).length };
        }),
        samples: RI.SAMPLES.map(function (s) {
          return { key: s.key, name: s.name, line: s.text.split('\n')[0].replace(/[\t;,]/g, ', ').slice(0, 60) + '…' };
        })
      });
    },
    /* The Casebook teaser on the landing page: one case with its history columns, signals and first model. */
    caseTeaser: function (id) {
      var c = RI.CASE[id], m = RI.MODEL[c.models[0][0]];
      return JSON.stringify({ id: c.id, ind: c.ind, no: c.no, name: c.name, q: c.q, model: m.name,
        cols: c.cols.slice(0, 4).map(function (s) { return s.split('|')[0]; }), sig: c.sig.slice(0, 3).map(function (s) { return s[1]; }) });
    },
    /* The lemma of the day (the notebook's side card). */
    lemma: function () {
      var day = Math.floor(Date.now() / 86400000), m = RI.MODELS[day % RI.MODELS.length];
      return JSON.stringify({ slug: m.slug, name: m.name, eq: m.eq, intuition: RI.mtext(m.intuition) });
    },
    eq: function (slug) { return (RI.MODEL[slug] || {}).eq || ''; },
    /* A listing's data description: the notation line and the column table (the listing page's side card). */
    specView: function (specJson, task) {
      var spec = RI.cleanSpec(JSON.parse(specJson)), xi = 0;
      return JSON.stringify({
        notation: RI.notation(spec), task: spec.task, file: spec.file,
        freq: spec.task === 'forecast' ? (RI.FREQ[spec.freq].name + ', horizon ' + spec.horizon + ' ' + RI.FREQ[spec.freq].unit) : '',
        columns: spec.columns.map(function (c) {
          var g = c.role === 'target' ? 'y' : c.role === 'time' ? 't' : c.role === 'group' ? 'g' : c.role === 'ignore' ? '∅' : 'x';
          return { glyph: g, sub: c.role === 'feature' ? String(++xi) : '', role: c.role, name: c.name, key: !!c.key,
            type: c.type + (c.known && task === 'forecast' ? ' · known' : '') };
        })
      });
    },
    generate: function (specJson, slug, title) { return JSON.stringify(RI.generate(JSON.parse(specJson), slug, title) || null); },
    /* Open a Lab sample (the notebook's quick starts): the Lab picks it up from the 'lab-load' store. */
    startSample: function (key) {
      var s = RI.SAMPLES.filter(function (x) { return x.key === key; })[0];
      var p = RI.parse(s.text);
      p.columns.forEach(function (c) { if (s.tweak) s.tweak(c); });
      UI.store.set('lab-load', { text: s.text, spec: { columns: p.columns, task: s.task, freq: s.freq, horizon: s.horizon, rows: s.rows, intervals: s.intervals, weights: { acc: 0.5, interp: 0.25, speed: 0.25 }, file: s.key + '.csv', missing: false } });
    },
    /* A code listing with its file tabs, copy / download / .ipynb buttons (RI.codeBlock + RI.wireCode). */
    codeBlock: function (el, filesJson, active, metaJson, canEdit, onEdit) {
      var files = JSON.parse(filesJson), meta = JSON.parse(metaJson), cur = active;
      function draw() {
        el.innerHTML = RI.codeBlock(files, cur, canEdit ? '<button type="button" class="ui-btn sm ghost" data-edit-code>' + UI.icon('edit') + '<span>Edit</span></button>' : '');
      }
      if (!el.__riWired) {
        el.__riWired = true;
        RI.wireCode(el, function () { return el.__riFiles; }, function () {}, function () { return el.__riMeta; });
        el.addEventListener('click', function (e) {
          var t = e.target.closest('[data-file]');
          if (t) { el.__riCur = t.getAttribute('data-file'); el.__riDraw(); return; }
          if (e.target.closest('[data-edit-code]') && el.__riOnEdit) el.__riOnEdit(el.__riCur);
        });
      }
      el.__riFiles = files; el.__riMeta = meta; el.__riCur = cur; el.__riOnEdit = onEdit;
      el.__riDraw = function () { cur = el.__riCur; draw(); };
      draw();
    }
  };
})();
