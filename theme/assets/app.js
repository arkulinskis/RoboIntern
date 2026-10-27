/* core.js: the shared front-end engine (window.UI). Same in every app made from APP_MAKER/template;
   app-specific things live in web/app.js (brand, nav, footer) and web/pages/*.html (the pages).

   Pages:   UI.page(name, {title, nav, icon, auth, order, chrome}, mount)
              auth: null (anyone) | 'guest' (signed-out only) | 'user' | 'admin'
              nav: label for the header / phone tab bar (omit to keep it out of the menus)
              mount(view, ctx) draws into `view`; ctx = {args, me, go, api}. Return a Promise (the page
              is "ready" when it resolves) or {ready, destroy}. URLs are #name/arg1/arg2.
   Server:  UI.api(fn, ...args) -> Promise of the server function's return value. A reply of
              {ok: false, error} rejects with that message (shown as a toast unless you .catch it).
            UI.apiQuiet(fn, ...args) is the same without Anvil's loading spinner.
   Auth:    UI.auth('login'|'signup'|'reset'|'logout', {...}) -> Promise of {ok, me, message}
   Helpers: UI.esc, UI.icon, UI.toast, UI.modal, UI.confirm, UI.busy, UI.formData, UI.fmtDate, UI.ago,
            UI.store, UI.setTheme, UI.feedback, UI.go, UI.refresh
   Tests:   window.UI_READY is true when the current page has finished loading. */
(function () {
  'use strict';
  if (window.UI && window.UI.__v) return;
  var UI = window.UI = { __v: 1, pages: {}, me: null, config: { name: 'App', key: 'app', home: 'home', landing: 'landing' } };
  window.UI_READY = false;

  UI.configure = function (cfg) { Object.keys(cfg).forEach(function (k) { UI.config[k] = cfg[k]; }); };

  /* ------------------------------------------------------------------ small helpers */
  UI.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  UI.plural = function (n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); };
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
  UI.store = {
    get: function (k, dflt) { try { var v = localStorage.getItem(UI.config.key + '.' + k); return v == null ? dflt : JSON.parse(v); } catch (e) { return dflt; } },
    set: function (k, v) { try { localStorage.setItem(UI.config.key + '.' + k, JSON.stringify(v)); } catch (e) {} }
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
  /* Disable a button while a Promise runs; returns the Promise. */
  UI.busy = function (btn, promise) {
    if (!btn) return promise;
    btn.disabled = true; btn.classList.add('is-busy');
    var done = function () { btn.disabled = false; btn.classList.remove('is-busy'); };
    promise.then(done, done);
    return promise;
  };

  var ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.5 3-5.5 6.5-5.5s6.5 2 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18 14.7c2.2.6 3.5 2.4 3.5 5.3"/>',
    sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12z"/>',
    bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    back: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    bug: '<rect x="7" y="8" width="10" height="12" rx="5"/><path d="M12 8V5M9 5.5 7.5 4M15 5.5 16.5 4M7 13H3M21 13h-4M7.5 18l-3 2M16.5 18l3 2M7.5 9.5l-3-2M16.5 9.5l3-2"/>',
    bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
    star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
    heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    inbox: '<path d="M3 13h5l1.5 3h5L16 13h5"/><path d="M5 5h14l2 8v6H3v-6z"/>',
    grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
    sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
    database: '<ellipse cx="12" cy="5.5" rx="7.5" ry="2.5"/><path d="M4.5 5.5v13c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-13"/><path d="M4.5 12c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 20v-4h-4"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
    pin: '<path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3v12H4z"/><circle cx="12" cy="13.5" r="3.5"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
    filter: '<path d="M4 5h16l-6 7.5V19l-4 1.5v-8z"/>',
    more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>'
  };
  UI.ICONS = ICONS;
  UI.icon = function (name, cls) {
    return '<svg class="ui-ic ' + (cls || '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || ICONS.sparkle) + '</svg>';
  };

  /* ------------------------------------------------------------------ toasts, modals */
  UI.toast = function (msg, kind) {
    var box = document.querySelector('.ui-toasts');
    if (!box) { box = document.createElement('div'); box.className = 'ui ui-toasts'; box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
    var t = document.createElement('div');
    t.className = 'ui-toast' + (kind ? ' ' + kind : '');
    t.innerHTML = (kind === 'error' ? UI.icon('info') : kind === 'ok' ? UI.icon('check') : '') + '<span>' + UI.esc(msg) + '</span>';
    box.appendChild(t);
    setTimeout(function () { t.classList.add('out'); setTimeout(function () { t.remove(); }, 300); }, kind === 'error' ? 6500 : 3200);
  };
  UI.modal = function (html, opts) {
    opts = opts || {};
    var prev = document.activeElement;
    var wrap = document.createElement('div');
    wrap.className = 'ui ui-modal-wrap';
    wrap.innerHTML = '<div class="ui-modal' + (opts.wide ? ' wide' : '') + '" role="dialog" aria-modal="true">' +
      '<button class="ui-btn ghost icon ui-modal-x" data-close aria-label="Close">' + UI.icon('x') + '</button>' + html + '</div>';
    document.body.appendChild(wrap);
    document.documentElement.classList.add('ui-modal-open');
    function key(e) { if (e.key === 'Escape') close(); }
    function close() {
      if (!wrap.parentNode) return;
      wrap.remove(); document.removeEventListener('keydown', key);
      if (!document.querySelector('.ui-modal-wrap')) document.documentElement.classList.remove('ui-modal-open');
      if (opts.onclose) opts.onclose();
      if (prev && prev.focus) prev.focus();
    }
    document.addEventListener('keydown', key);
    wrap.addEventListener('mousedown', function (e) { if (e.target === wrap) close(); });
    wrap.addEventListener('click', function (e) { if (e.target.closest('[data-close]')) close(); });
    var first = wrap.querySelector('input, textarea, select');
    setTimeout(function () { (first || wrap.querySelector('.ui-modal')).focus && (first || wrap.querySelector('.ui-modal')).focus(); }, 30);
    return { el: wrap.querySelector('.ui-modal'), close: close };
  };
  UI.confirm = function (o) {
    o = typeof o === 'string' ? { title: o } : (o || {});
    return new Promise(function (resolve) {
      var answered = false;
      var m = UI.modal('<h2>' + UI.esc(o.title || 'Are you sure?') + '</h2>' + (o.text ? '<p class="muted">' + UI.esc(o.text) + '</p>' : '') +
        '<div class="ui-row end" style="margin-top:20px"><button class="ui-btn ghost" data-close>' + UI.esc(o.cancel || 'Cancel') + '</button>' +
        '<button class="ui-btn ' + (o.danger ? 'danger solid' : 'primary') + '" data-ok>' + UI.esc(o.ok || 'OK') + '</button></div>',
      { onclose: function () { if (!answered) resolve(false); } });
      m.el.querySelector('[data-ok]').onclick = function () { answered = true; m.close(); resolve(true); };
    });
  };

  /* ------------------------------------------------------------------ theme */
  UI.theme = function () { return UI.store.get('theme', 'auto'); };
  UI.applyTheme = function (t) {
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
    var dark = t === 'dark' || (t !== 'light' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('ui-dark', !!dark);
  };
  UI.setTheme = function (t) { UI.store.set('theme', t); UI.applyTheme(t); };
  UI.applyTheme(UI.theme());
  if (window.matchMedia) {
    try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { UI.applyTheme(UI.theme()); }); } catch (e) {}
  }

  /* ------------------------------------------------------------------ server bridge */
  var bridge = null;
  function send(kind, payload) {
    if (!bridge) return Promise.reject(new Error('The app is still starting.'));
    var out;
    try { out = bridge(kind, JSON.stringify(payload || {})); } catch (e) { return Promise.reject(e); }
    return Promise.resolve(out).then(function (r) {
      r = typeof r === 'string' ? JSON.parse(r) : (r || {});
      if (r.error) {
        var err = new Error(r.error); err.uiApi = true; err.denied = !!r.denied;
        if (r.detail) console.error(kind, payload && payload.fn, r.detail);
        if (r.reload) setTimeout(function () { location.reload(); }, 2500);
        throw err;
      }
      return r.result;
    });
  }
  function apiCall(quiet, fn, args) {
    return send('call', { fn: fn, args: args, quiet: quiet }).then(function (res) {
      if (res && typeof res === 'object' && res.ok === false) {
        var err = new Error(res.error || 'That didn\'t work.'); err.uiApi = true; err.expected = true; err.result = res;
        throw err;
      }
      return res;
    });
  }
  UI.api = function (fn) { return apiCall(false, fn, Array.prototype.slice.call(arguments, 1)); };
  UI.apiQuiet = function (fn) { return apiCall(true, fn, Array.prototype.slice.call(arguments, 1)); };
  /* Errors nobody caught become a toast, so a failed action is never silent. */
  window.addEventListener('unhandledrejection', function (e) {
    if (e.reason && e.reason.uiApi) { e.preventDefault(); UI.toast(e.reason.message, 'error'); }
  });

  /* Sign in / up / out. On success it navigates: to where the visitor was heading (UI.after) or home
     after signing in, to the landing page after signing out. */
  UI.auth = function (kind, payload) {
    return send(kind, payload || {}).then(function (r) {
      if (r && r.ok === false) { var err = new Error(r.error); err.uiApi = true; err.expected = true; throw err; }
      if (r && 'me' in r && (r.me || kind === 'logout')) {
        UI.me = r.me || null;
        var target = r.me ? (UI.after || '#' + UI.config.home) : '#' + UI.config.landing;
        UI.after = null;
        if (location.hash === target) route(); else location.hash = target;
      }
      return r;
    });
  };
  /* Update the signed-in user's details (e.g. a new name) and redraw the header, without reloading the page. */
  UI.setMe = function (me) {
    UI.me = me || null;
    if (shellRoot) renderChrome(current.name);
  };

  /* ------------------------------------------------------------------ pages and routing */
  UI.page = function (name, opts, mount) {
    if (typeof opts === 'function') { mount = opts; opts = {}; }
    opts.name = name; opts.mount = mount;
    UI.pages[name] = opts;
  };
  UI.allowed = function (p) {
    if (!p) return false;
    if (p.auth === 'user') return !!UI.me;
    if (p.auth === 'admin') return !!(UI.me && UI.me.is_admin);
    if (p.auth === 'guest') return !UI.me;
    return true;
  };
  UI.navPages = function () {
    return Object.keys(UI.pages).map(function (k) { return UI.pages[k]; })
      .filter(function (p) { return p.nav && UI.allowed(p) && (!p.when || p.when()); })
      .sort(function (a, b) { return (a.order || 50) - (b.order || 50); });
  };
  UI.parseHash = function () {
    var h = (location.hash || '').replace(/^#!?\/?/, '');
    var parts = h.split('?')[0].split('/').filter(function (x) { return x !== ''; }).map(decodeURIComponent);
    return { name: parts[0] || '', args: parts.slice(1) };
  };
  UI.hashFor = function (name) {
    var args = Array.prototype.slice.call(arguments, 1).filter(function (a) { return a != null && a !== ''; });
    return '#' + [name].concat(args.map(encodeURIComponent)).join('/');
  };
  UI.go = function (name) {
    var h = UI.hashFor.apply(null, arguments);
    if (location.hash === h) route(); else location.hash = h;
  };
  UI.refresh = function () { route(); };
  UI.after = null;  // where to go after signing in

  var shellRoot = null, view = null, current = { name: null, destroy: null }, routeSeq = 0;

  function defaultPage() { return UI.me ? UI.config.home : UI.config.landing; }

  function route() {
    var r = UI.parseHash(), name = r.name || defaultPage(), p = UI.pages[name];
    if (!p) { name = defaultPage(); p = UI.pages[name]; r.args = []; }
    if (p.auth === 'guest' && UI.me) { p = UI.pages[UI.config.home]; name = UI.config.home; r.args = []; }
    if ((p.auth === 'user' || p.auth === 'admin') && !UI.me) {
      UI.after = location.hash && location.hash !== '#' ? location.hash : null;
      p = UI.pages.auth; name = 'auth'; r.args = [];
    }
    if (p.auth === 'admin' && !(UI.me && UI.me.is_admin)) {
      UI.toast('That page is for admins only.', 'error');
      p = UI.pages[UI.config.home]; name = UI.config.home; r.args = [];
    }
    var seq = ++routeSeq;
    window.UI_READY = false;
    if (current.destroy) { try { current.destroy(); } catch (e) { console.error(e); } }
    current = { name: name, args: r.args, destroy: null };
    if (shellRoot) {
      shellRoot.className = 'ui ui-shell page-' + name + (UI.me ? ' signed-in' : ' signed-out') + (p.chrome === false ? ' no-chrome' : '');
      renderChrome(name);
    }
    // A fresh element for every page, so listeners a page adds to `view` never pile up.
    var fresh = view.cloneNode(false);
    view.parentNode.replaceChild(fresh, view);
    view = fresh;
    window.scrollTo(0, 0);
    document.title = (p.title ? (typeof p.title === 'function' ? p.title(r.args) : p.title) + ' · ' : '') + UI.config.name;
    var ctx = { name: name, args: r.args, me: UI.me, go: UI.go, api: UI.api, page: p };
    var out;
    try { out = p.mount(view, ctx); } catch (e) { console.error(e); out = Promise.reject(e); }
    var ready = out && typeof out.then === 'function' ? out : (out && out.ready) || Promise.resolve();
    if (out && out.destroy) current.destroy = out.destroy;
    Promise.resolve(ready).then(function () { if (seq === routeSeq) window.UI_READY = true; },
      function (e) {
        if (seq !== routeSeq) return;
        console.error(e);
        if (!view.innerHTML) view.innerHTML = '<div class="ui-wrap"><div class="ui-empty">' + UI.icon('info') +
          '<h3>This page didn\'t load</h3><p class="muted">' + UI.esc(e && e.message || 'Something went wrong.') + '</p>' +
          '<button class="ui-btn" onclick="UI.refresh()">Try again</button></div></div>';
        window.UI_READY = true;
      });
  }
  UI.current = function () { return current; };

  /* The shell's parts come from web/app.js: UI.shell = {header(me, active), footer(me), tabbar(me, active)} */
  function renderChrome(active) {
    var S = UI.shell || {};
    var hd = shellRoot.querySelector('[data-ui-header]'), ft = shellRoot.querySelector('[data-ui-footer]'), tb = shellRoot.querySelector('[data-ui-tabbar]');
    if (hd) hd.innerHTML = S.header ? S.header(UI.me, active) : '';
    if (ft) ft.innerHTML = S.footer ? S.footer(UI.me, active) : '';
    if (tb) tb.innerHTML = S.tabbar ? S.tabbar(UI.me, active) : '';
  }
  UI.renderChrome = function () { if (shellRoot) renderChrome(current.name); };

  /* Called by client_code/Main.py (and by the local harness) once the page is up. */
  UI.start = function (node, bridgeFn, bootJson) {
    bridge = bridgeFn;
    var boot = typeof bootJson === 'string' ? JSON.parse(bootJson || '{}') : (bootJson || {});
    UI.me = boot.me || null;
    var host = node && node.matches && node.matches('[data-ui-app]') ? node : (node && node.querySelector('[data-ui-app]')) || node || document.body;
    host.innerHTML = '<div class="ui ui-shell">' +
      '<header class="ui-header" data-ui-header></header>' +
      '<main class="ui-main" data-ui-view></main>' +
      '<footer class="ui-footer" data-ui-footer></footer>' +
      '<nav class="ui-tabbar" data-ui-tabbar aria-label="Main"></nav></div>';
    shellRoot = host.firstChild;
    view = host.querySelector('[data-ui-view]');
    if (UI.shell && UI.shell.wire) UI.shell.wire(shellRoot);
    window.addEventListener('hashchange', route);
    route();
  };

  /* ------------------------------------------------------------------ feedback form (footer + menu) */
  UI.feedback = function (kind) {
    var kinds = [['bug', 'Something\'s broken', 'bug'], ['idea', 'An idea', 'bulb'], ['question', 'A question', 'info'], ['other', 'Something else', 'chat']];
    var m = UI.modal('<h2>Send feedback</h2><p class="muted">Found a bug or have an idea? It goes straight to the people who make ' + UI.esc(UI.config.name) + '.</p>' +
      '<form class="ui-stack" data-fb>' +
      '<div class="ui-choices">' + kinds.map(function (k) {
        return '<label class="ui-choice"><input type="radio" name="kind" value="' + k[0] + '"' + ((kind || 'bug') === k[0] ? ' checked' : '') + '>' +
          '<span>' + UI.icon(k[2]) + UI.esc(k[1]) + '</span></label>';
      }).join('') + '</div>' +
      '<label class="ui-field"><span>What happened, or what would you like?</span><textarea name="message" rows="5" required minlength="5" placeholder="The more detail, the better."></textarea></label>' +
      (UI.me ? '' : '<label class="ui-field"><span>Your email <em>(optional, if you\'d like a reply)</em></span><input type="email" name="email" autocomplete="email"></label>') +
      '<p class="ui-hint">We also send the page you were on, your screen size and browser, to help us fix bugs.</p>' +
      '<div class="ui-row end"><button type="button" class="ui-btn ghost" data-close>Cancel</button><button class="ui-btn primary" type="submit">' + UI.icon('arrow') + 'Send</button></div></form>');
    var form = m.el.querySelector('[data-fb]');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = UI.formData(form);
      var ctx = { page: location.hash || '#', screen: innerWidth + 'x' + innerHeight, browser: navigator.userAgent.slice(0, 280), theme: UI.theme() };
      UI.busy(form.querySelector('[type=submit]'), UI.api('submit_feedback', v.kind, v.message, v.email || null, ctx)).then(function () {
        m.close(); UI.toast('Thank you! Your message was sent.', 'ok');
      });
    });
    return m;
  };

  /* Shared clicks: [data-go="page/arg"], [data-feedback], [data-theme-set] anywhere in the app. */
  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('[data-go],[data-feedback],[data-theme-set]');
    if (!el) return;
    if (el.hasAttribute('data-go')) { e.preventDefault(); UI.go.apply(null, el.getAttribute('data-go').split('/')); }
    else if (el.hasAttribute('data-feedback')) { e.preventDefault(); UI.feedback(el.getAttribute('data-feedback') || null); }
    else if (el.hasAttribute('data-theme-set')) { e.preventDefault(); UI.setTheme(el.getAttribute('data-theme-set')); if (UI.shell && UI.shell.onTheme) UI.shell.onTheme(); }
  });
})();


/* app.js: this app's identity and frame: name, header, footer, phone tab bar.
   Pages live in web/pages/*.html. The engine (window.UI) is web/core.js. */
(function () {
  'use strict';
  UI.configure({
    name: 'RoboIntern',
    key: 'robointern',          // prefix for this app's browser storage
    tagline: 'A field guide to predictive models, with the Python included.',   // footer line
    home: 'notebook',            // first page after signing in
    landing: 'landing'           // first page for visitors who aren't signed in
  });

  var esc = UI.esc;

  function brand() {
    return '<a class="ui-brand" href="#" data-go="' + (UI.me ? UI.config.home : UI.config.landing) + '" aria-label="' + esc(UI.config.name) + ' home">' +
      '<img src="_/theme/icon.svg" alt="" width="32" height="32"><span>Robo<i>Intern</i></span></a>';
  }

  function themeSwitch() {
    var t = UI.theme();
    return '<div class="ui-seg" role="group" aria-label="Appearance">' + [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(function (o) {
      return '<button type="button" data-theme-set="' + o[0] + '" class="' + (t === o[0] ? 'on' : '') + '">' + o[1] + '</button>';
    }).join('') + '</div>';
  }

  function userMenu(me) {
    return '<div class="ui-menu" data-menu hidden>' +
      '<div class="ui-menu-head"><strong>' + esc(me.name) + '</strong><span class="muted small">' + esc(me.email) + '</span></div>' +
      '<a href="#profile" data-go="profile">' + UI.icon('user') + 'Your profile</a>' +
      (me.is_admin ? '<a href="#admin" data-go="admin">' + UI.icon('shield') + 'Admin</a>' : '') +
      '<div class="ui-menu-block"><span class="small muted">Appearance</span>' + themeSwitch() + '</div>' +
      '<button type="button" data-feedback>' + UI.icon('chat') + 'Send feedback</button>' +
      '<button type="button" data-lk-open="overview">' + UI.icon('lock') + 'Privacy &amp; Terms</button>' +
      '<button type="button" data-signout>' + UI.icon('logout') + 'Sign out</button></div>';
  }

  UI.shell = {
    header: function (me, active) {
      var nav = UI.navPages();
      return '<div class="ui-header-in">' + brand() +
        (nav.length ? '<nav class="ui-nav" aria-label="Main">' + nav.map(function (p) {
          return '<a href="#' + p.name + '" class="' + (p.name === active ? 'on' : '') + '">' + UI.icon(p.icon) + '<span>' + esc(p.nav) + '</span></a>';
        }).join('') + '</nav>' : '') +
        '<div class="ui-header-right">' +
        (me ? '<button type="button" class="ui-avatar-btn" data-menu-toggle aria-label="Your account" aria-haspopup="true">' + esc(UI.initials(me.name)) + '</button>' + userMenu(me)
          : (active === 'auth' ? '' : '<a class="ui-btn ghost" href="#auth" data-go="auth">Sign in</a><a class="ui-btn primary" href="#auth/signup" data-go="auth/signup">Get started</a>')) +
        '</div></div>';
    },
    footer: function (me) {
      return '<div class="ui-footer-in"><div class="ui-footer-brand">' + brand() + '<p class="muted small">' + esc(UI.config.tagline) + '</p></div>' +
        '<div class="ui-footer-links">' +
        '<a href="#landing" data-go="landing">About</a>' +
        '<a href="#atlas" data-go="atlas">Atlas</a>' +
        '<a href="#lab" data-go="lab">Lab</a>' +
        '<a href="#commons" data-go="commons">Commons</a>' +
        '<button type="button" data-feedback>Send feedback</button>' +
        '<button type="button" data-lk-open="overview">Privacy &amp; Terms</button>' +
        '</div><p class="ui-footer-legal small muted">© ' + new Date().getFullYear() + ' ' + esc(UI.config.name) + ' · <span class="mono">∎</span> Q.E.D.</p></div>';
    },
    tabbar: function (me, active) {
      var nav = UI.navPages();
      if (!me || nav.length < 2) return '';
      return nav.slice(0, 4).map(function (p) {
        return '<a href="#' + p.name + '" class="' + (p.name === active ? 'on' : '') + '">' + UI.icon(p.icon) + '<span>' + esc(p.nav) + '</span></a>';
      }).join('') + '<a href="#profile" class="' + (active === 'profile' ? 'on' : '') + '">' + UI.icon('user') + '<span>You</span></a>';
    },
    wire: function (root) {
      root.addEventListener('click', function (e) {
        var t = e.target.closest('[data-menu-toggle]');
        var menu = root.querySelector('[data-menu]');
        if (t && menu) { menu.hidden = !menu.hidden; t.setAttribute('aria-expanded', String(!menu.hidden)); return; }
        if (e.target.closest('[data-signout]')) { UI.auth('logout').then(function () { UI.toast('Signed out. See you soon!'); }); }
        if (menu && !menu.hidden && !e.target.closest('[data-menu] .ui-seg')) menu.hidden = true;
      });
      document.addEventListener('keydown', function (e) {
        var menu = root.querySelector('[data-menu]');
        if (e.key === 'Escape' && menu) menu.hidden = true;
      });
    },
    onTheme: function () {  // redraw the menu's Auto/Light/Dark buttons and keep the menu open
      var menu = document.querySelector('[data-menu]'), open = menu && !menu.hidden;
      UI.renderChrome();
      if (open) document.querySelector('[data-menu]').hidden = false;
    }
  };
})();


/* ===== _atlas_data.html ===== */
(function () {
  'use strict';
  var RI = window.RI = window.RI || {};
  var T = String.raw;

  RI.FAMILIES = {
    baseline: { name: 'Baselines', n: 1, blurb: 'The forecasts every model has to beat. If you skip them you can\'t tell whether a clever model helps.' },
    linear: { name: 'Linear & generalised linear', n: 2, blurb: 'A weighted sum of the features, sometimes passed through a link function. Fast, stable, and easy to read.' },
    kernel: { name: 'Instance & kernel methods', n: 3, blurb: 'Predict from similarity to known examples, measured directly or through a kernel.' },
    prob: { name: 'Probabilistic models', n: 4, blurb: 'Model a distribution, not just a point. Uncertainty comes with the prediction.' },
    trees: { name: 'Trees & bagging', n: 5, blurb: 'Axis-aligned splits that capture non-linearity and interactions on their own. Bagging averages many trees to cut variance.' },
    boosting: { name: 'Gradient boosting', n: 6, blurb: 'Trees added one at a time, each fitted to the remaining errors. The usual winner on tabular data.' },
    neural: { name: 'Neural networks', n: 7, blurb: 'Learned representations. They need data and tuning, and pay off on long sequences and many related series.' },
    classical: { name: 'Classical time series', n: 8, blurb: 'Statistical models of a single series\' level, trend, seasonality and autocorrelation. Hard to beat on short, clean series.' },
    foundation: { name: 'Foundation models', n: 9, blurb: 'Large networks pretrained on huge collections of time series. They forecast your series zero-shot: no training on your data, just inference.' },
    anomaly: { name: 'Anomaly detection', n: 10, blurb: 'No target needed: they learn what normal looks like and score how far each row is from it. A true/false label, if you have one, is only used to measure them.' },
    cluster: { name: 'Clustering', n: 11, blurb: 'Group similar rows without a target: segments, personas, regimes. Judged by how tight and well separated the groups are.' }
  };
  RI.TASKS = { forecast: 'Forecasting', regression: 'Regression', binary: 'Binary classification', multiclass: 'Multiclass classification', anomaly: 'Anomaly detection', cluster: 'Clustering' };
  RI.TASK_SHORT = { forecast: 'Forecast', regression: 'Regression', binary: 'Binary', multiclass: 'Multiclass', anomaly: 'Anomalies', cluster: 'Clusters' };
  RI.ROWS = { xs: '< 1k rows', s: '1k – 10k', m: '10k – 100k', l: '100k – 1M', xl: '> 1M rows' };
  RI.ROW_ORDER = ['xs', 's', 'm', 'l', 'xl'];

  var REG = ['regression'], CLF = ['binary', 'multiclass'], ALL = ['forecast', 'regression', 'binary', 'multiclass'];

  RI.MODELS = [
    /* ---------------------------------------------------------------- baselines */
    { slug: 'naive', name: 'Seasonal naïve', short: 'SNaive', family: 'baseline', tasks: ['forecast'], lib: 'numpy / pandas', pip: [],
      power: 1, interp: 5, speed: 5, minRows: 'xs', maxRows: 'xl', cat: false, miss: false, ivals: false, global: false, scale: false, tmpl: 'stat',
      summary: 'Each future value is the value from the same point one season earlier. Zero parameters, and a benchmark that is surprisingly hard to beat.',
      eq: T`\hat y_{T+h\mid T} = y_{T+h-m\lceil h/m\rceil}`, eqNote: T`$m$ is the season length (7 for daily data with a weekly cycle, 12 for monthly).`,
      obj: '', intuition: 'Next Monday will look like last Monday. If your fancy model can\'t beat that, it isn\'t learning anything useful. MASE, the standard forecast metric, is literally your error divided by this model\'s error.',
      assumptions: ['The seasonal pattern repeats exactly', 'No trend, or a trend that is negligible over the horizon'],
      params: [['m (season length)', 'by frequency: 24, 7, 52, 12, 4', 'Which earlier value gets copied']],
      pros: ['Instant, no training', 'Impossible to overfit', 'The denominator of MASE'], cons: ['Ignores trend, drivers and holidays', 'Copies last season\'s noise forward'],
      use: 'Always, as the first line of your results table.', complexity: [T`O(1)`, T`O(h)`], related: ['ets', 'theta', 'arima'] },

    /* ---------------------------------------------------------------- linear */
    { slug: 'linreg', name: 'Linear regression (OLS)', short: 'OLS', family: 'linear', tasks: ['regression', 'forecast'], lib: 'scikit-learn', pip: ['scikit-learn'],
      power: 2, interp: 5, speed: 5, minRows: 'xs', maxRows: 'xl', cat: false, miss: false, ivals: false, global: true, scale: true, tmpl: 'tab',
      summary: 'Fits the hyperplane that minimises the squared errors. The reference point for every regression problem.',
      eq: T`\hat y = \beta_0 + \sum_{j=1}^{p} \beta_j x_j = \mathbf x^\top\boldsymbol\beta`, eqNote: '',
      obj: T`\hat{\boldsymbol\beta} = \arg\min_{\boldsymbol\beta}\ \lVert \mathbf y - X\boldsymbol\beta \rVert_2^2 = (X^\top X)^{-1}X^\top \mathbf y`,
      intuition: 'Each feature gets one number: how much the prediction moves when that feature goes up by one, holding the others fixed. The model is that list of numbers.',
      assumptions: ['Relationship is linear in the parameters', 'Errors are independent with constant variance', 'Features are not strongly collinear'],
      params: [['fit_intercept', 'True', 'Include β₀']],
      pros: ['Closed-form, instant', 'Coefficients are directly readable', 'Extrapolates trends (for better or worse)'],
      cons: ['Misses non-linearity unless you engineer it', 'Unstable with correlated features', 'Sensitive to outliers'],
      use: 'As a baseline, when you need to explain every coefficient, or when the data is small and roughly linear.', complexity: [T`O(np^2)`, T`O(p)`], related: ['ridge', 'lasso', 'glm'] },
    { slug: 'ridge', name: 'Ridge regression', short: 'Ridge', family: 'linear', tasks: ['regression', 'forecast'], lib: 'scikit-learn', pip: ['scikit-learn'],
      power: 2.3, interp: 4.6, speed: 5, minRows: 'xs', maxRows: 'xl', cat: false, miss: false, ivals: false, global: true, scale: true, tmpl: 'tab',
      summary: 'Least squares with an L2 penalty that shrinks coefficients toward zero. It stays stable when features are correlated or there are many of them.',
      eq: T`\hat y = \mathbf x^\top \hat{\boldsymbol\beta}_{\text{ridge}}`, eqNote: '',
      obj: T`\hat{\boldsymbol\beta} = \arg\min_{\boldsymbol\beta} \lVert \mathbf y - X\boldsymbol\beta\rVert_2^2 + \alpha\lVert\boldsymbol\beta\rVert_2^2 = (X^\top X + \alpha I)^{-1}X^\top\mathbf y`,
      intuition: 'Adding αI to XᵀX makes the problem well-conditioned. Equivalently it is a Gaussian prior on the weights: a little bias in exchange for much less variance.',
      assumptions: ['Linear relationship', 'Features on comparable scales (standardise first)'],
      params: [['alpha', '1e-3 – 1e3 (log scale)', 'Shrinkage strength; tune with CV']],
      pros: ['Handles multicollinearity', 'Works with p > n', 'Still closed-form'], cons: ['Keeps every feature (no selection)', 'Still linear'],
      use: 'Your default linear model. Many engineered lag features are correlated, which is exactly the case ridge handles.', complexity: [T`O(np^2 + p^3)`, T`O(p)`], related: ['lasso', 'enet', 'bayesridge'] },
    { slug: 'lasso', name: 'Lasso', short: 'Lasso', family: 'linear', tasks: ['regression', 'forecast'], lib: 'scikit-learn', pip: ['scikit-learn'],
      power: 2.3, interp: 4.8, speed: 4.8, minRows: 'xs', maxRows: 'xl', cat: false, miss: false, ivals: false, global: true, scale: true, tmpl: 'tab',
      summary: 'An L1 penalty drives many coefficients exactly to zero, so the model does its own feature selection.',
      eq: T`\hat y = \mathbf x^\top \hat{\boldsymbol\beta}_{\text{lasso}}`, eqNote: '',
      obj: T`\hat{\boldsymbol\beta} = \arg\min_{\boldsymbol\beta} \tfrac{1}{2n}\lVert \mathbf y - X\boldsymbol\beta\rVert_2^2 + \alpha\lVert\boldsymbol\beta\rVert_1`,
      intuition: 'The L1 ball has corners on the axes, and the optimum tends to land on one, which sets some coefficients to exactly zero. You get a sparse, readable model.',
      assumptions: ['Only a few features truly matter (sparsity)', 'Standardised features'],
      params: [['alpha', '1e-4 – 1 (log scale)', 'Higher means fewer features survive']],
      pros: ['Automatic feature selection', 'Very readable'], cons: ['Picks one of a group of correlated features more or less at random', 'Biased estimates of the survivors'],
      use: 'You have many candidate features and suspect most are noise.', complexity: [T`O(np \cdot \text{iters})`, T`O(p)`], related: ['enet', 'ridge'] },
    { slug: 'enet', name: 'Elastic Net', short: 'ENet', family: 'linear', tasks: ['regression', 'forecast'], lib: 'scikit-learn', pip: ['scikit-learn'],
      power: 2.4, interp: 4.6, speed: 4.7, minRows: 'xs', maxRows: 'xl', cat: false, miss: false, ivals: false, global: true, scale: true, tmpl: 'tab',
      summary: 'A blend of the ridge and lasso penalties: sparse like lasso, stable with correlated groups like ridge.',
      eq: T`\hat y = \mathbf x^\top \hat{\boldsymbol\beta}`, eqNote: T`$\rho$ = l1_ratio mixes the two penalties.`,
      obj: T`\min_{\boldsymbol\beta}\ \tfrac{1}{2n}\lVert\mathbf y - X\boldsymbol\beta\rVert_2^2 + \alpha\rho\lVert\boldsymbol\beta\rVert_1 + \tfrac{\alpha(1-\rho)}{2}\lVert\boldsymbol\beta\rVert_2^2`,
      intuition: 'Lasso picks one of a group of correlated features. Elastic Net keeps or drops the group together, which is nicer for lag features that move as a pack.',
      assumptions: ['Linear relationship', 'Standardised features'],
      params: [['alpha', '1e-4 – 1', 'Overall strength'], ['l1_ratio', '0.1 – 0.9', '0 = ridge, 1 = lasso']],
      pros: ['Sparse and stable', 'Good with grouped features'], cons: ['Two hyperparameters to tune'],
      use: 'Lots of correlated features and you still want selection.', complexity: [T`O(np \cdot \text{iters})`, T`O(p)`], related: ['lasso', 'ridge'] },
    { slug: 'logreg', name: 'Logistic regression', short: 'Logit', family: 'linear', tasks: CLF, lib: 'scikit-learn', pip: ['scikit-learn'],
      power: 2.4, interp: 4.8, speed: 5, minRows: 'xs', maxRows: 'xl', cat: false, miss: false, ivals: false, global: true, scale: true, tmpl: 'tab',
      summary: 'A linear model of the log-odds. It gives well-calibrated probabilities and coefficients you can read as odds ratios.',
      eq: T`P(y=1\mid\mathbf x) = \sigma(\mathbf x^\top\boldsymbol\beta) = \frac{1}{1+e^{-\mathbf x^\top\boldsymbol\beta}}`, eqNote: T`Multiclass uses the softmax: $P(y=k\mid\mathbf x) = e^{\mathbf x^\top\boldsymbol\beta_k}/\sum_j e^{\mathbf x^\top\boldsymbol\beta_j}$.`,
      obj: T`\min_{\boldsymbol\beta}\ -\sum_i \big[y_i\log p_i + (1-y_i)\log(1-p_i)\big] + \tfrac{1}{2C}\lVert\boldsymbol\beta\rVert_2^2`,
      intuition: 'e^βⱼ is the factor by which the odds multiply when feature j goes up by one. Business people can follow that.',
      assumptions: ['Log-odds linear in the features', 'Independent observations'],
      params: [['C', '1e-3 – 1e2 (log scale)', 'Inverse regularisation'], ['class_weight', '"balanced" for rare positives', 'Reweights the loss']],
      pros: ['Calibrated probabilities', 'Odds-ratio interpretation', 'Fast and robust'], cons: ['Linear decision boundary', 'Needs feature engineering for interactions'],
      use: 'The first classifier to try, and often the one that ships when explanations matter.', complexity: [T`O(np \cdot \text{iters})`, T`O(p)`], related: ['nb', 'catboost', 'tree'] },
    { slug: 'glm', name: 'Poisson GLM', short: 'Poisson', family: 'linear', tasks: ['regression', 'forecast'], lib: 'scikit-learn', pip: ['scikit-learn'],
      power: 2.5, interp: 4.5, speed: 4.7, minRows: 'xs', maxRows: 'xl', cat: false, miss: false, ivals: false, global: true, scale: true, tmpl: 'tab',
      summary: 'A generalised linear model with a log link, built for non-negative counts (sales units, visits, claims). Predictions can never go negative.',
      eq: T`\log \mathbb E[y\mid\mathbf x] = \mathbf x^\top\boldsymbol\beta \quad\Rightarrow\quad \hat y = e^{\mathbf x^\top\boldsymbol\beta}`, eqNote: 'Swap in TweedieRegressor(power=1.5) for counts with many zeros, or for money amounts.',
      obj: T`\min_{\boldsymbol\beta}\ \tfrac{1}{n}\sum_i \big(e^{\mathbf x_i^\top\boldsymbol\beta} - y_i\,\mathbf x_i^\top\boldsymbol\beta\big) + \tfrac{\alpha}{2}\lVert\boldsymbol\beta\rVert_2^2`,
      intuition: 'Effects multiply instead of add: a promo means +20%, not +20 units. That matches how most counts behave.',
      assumptions: [T`$y \ge 0$`, 'Variance grows with the mean (Poisson: equal to it)'],
      params: [['alpha', '1e-4 – 1', 'L2 strength']],
      pros: ['Respects the count nature of y', 'Multiplicative, readable effects'], cons: ['Overdispersed data needs Tweedie or negative binomial'],
      use: 'Your target is a count or an amount that can\'t be negative.', complexity: [T`O(np \cdot \text{iters})`, T`O(p)`], related: ['linreg', 'lgbm'] },

    /* ---------------------------------------------------------------- kernel / instance */
    { slug: 'knn', name: 'k-nearest neighbours', short: 'kNN', family: 'kernel', tasks: ['regression', 'binary', 'multiclass'], lib: 'scikit-learn', pip: ['scikit-learn'],
      power: 2.5, interp: 3, speed: 3, minRows: 'xs', maxRows: 'l', cat: false, miss: false, ivals: false, global: false, scale: true, tmpl: 'tab',
      summary: 'Predicts by averaging (or voting among) the k most similar training rows. No training, all the work happens at query time.',
      eq: T`\hat y(\mathbf x) = \frac{\sum_{i\in N_k(\mathbf x)} w_i\, y_i}{\sum_{i\in N_k(\mathbf x)} w_i},\qquad w_i = \lVert \mathbf x - \mathbf x_i\rVert^{-1}`, eqNote: '',
      obj: '', intuition: '"Show me similar cases." The prediction is literally the outcome of the nearest examples, so you can show them as the explanation.',
      assumptions: ['Similar inputs give similar outputs', 'Distance is meaningful: scale your features'],
      params: [['n_neighbors', '5 – 50', 'Bias–variance knob'], ['weights', 'uniform | distance', 'Closer neighbours count more']],
      pros: ['No training', 'Explains by example', 'Non-parametric'], cons: ['Curse of dimensionality', 'Slow queries on big data', 'Can\'t extrapolate'],
      use: 'Low-dimensional data where "similar cases" is the natural explanation.', complexity: [T`O(1)`, T`O(np)`], related: ['gp', 'svm'] },
    { slug: 'svm', name: 'Support vector machine', short: 'SVM', family: 'kernel', tasks: ['regression', 'binary', 'multiclass'], lib: 'scikit-learn', pip: ['scikit-learn'],
      power: 3.2, interp: 2, speed: 2, minRows: 'xs', maxRows: 'm', cat: false, miss: false, ivals: false, global: false, scale: true, tmpl: 'tab',
      summary: 'Finds the maximum-margin boundary (SVC), or the flattest function within an ε-tube (SVR), in a kernel-induced feature space.',
      eq: T`f(\mathbf x) = \sum_i \alpha_i\, K(\mathbf x_i, \mathbf x) + b,\qquad K(\mathbf x,\mathbf x') = e^{-\gamma\lVert\mathbf x-\mathbf x'\rVert^2}`, eqNote: T`Only support vectors have $\alpha_i \neq 0$.`,
      obj: T`\min_{\mathbf w,b,\boldsymbol\xi}\ \tfrac12\lVert\mathbf w\rVert^2 + C\sum_i \xi_i \quad \text{s.t.}\quad y_i(\mathbf w^\top\phi(\mathbf x_i)+b) \ge 1-\xi_i,\ \xi_i\ge 0`,
      intuition: 'Of all boundaries that separate the classes, take the one with the widest margin. The kernel trick gives you curved boundaries without ever computing the curved features.',
      assumptions: ['Scaled features', 'Moderate n (the kernel matrix is n × n)'],
      params: [['C', '0.1 – 100', 'Penalty on margin violations'], ['gamma', '"scale" or 1e-4 – 1', 'RBF width'], ['epsilon (SVR)', '0.01 – 1', 'Tube width']],
      pros: ['Strong on small, high-dimensional data', 'Convex: a unique optimum'], cons: [T`$O(n^2)$–$O(n^3)$ training`, 'Probabilities need extra calibration', 'Hard to explain'],
      use: 'Up to roughly 50k rows of dense numeric features, when trees underperform.', complexity: [T`O(n^2 p) \text{ to } O(n^3)`, T`O(n_{sv}\,p)`], related: ['gp', 'knn', 'logreg'] },

    /* ---------------------------------------------------------------- probabilistic */
    { slug: 'gp', name: 'Gaussian process', short: 'GP', family: 'prob', tasks: ['regression'], lib: 'scikit-learn', pip: ['scikit-learn'],
      power: 3.3, interp: 3, speed: 1.5, minRows: 'xs', maxRows: 's', cat: false, miss: false, ivals: true, global: false, scale: true, tmpl: 'tab',
      summary: 'A prior over functions, updated by the data into a posterior. Every prediction comes with a principled standard deviation.',
      eq: T`f \sim \mathcal{GP}\big(0,\,k(\mathbf x,\mathbf x')\big),\quad \mu_* = \mathbf k_*^\top (K+\sigma_n^2 I)^{-1}\mathbf y,\quad \sigma_*^2 = k_{**} - \mathbf k_*^\top(K+\sigma_n^2I)^{-1}\mathbf k_*`, eqNote: 'The kernel encodes what "smooth" means: RBF, Matérn, periodic, or sums of them.',
      obj: T`\max_\theta\ \log p(\mathbf y\mid X,\theta) = -\tfrac12\mathbf y^\top K_\theta^{-1}\mathbf y - \tfrac12\log|K_\theta| - \tfrac n2\log 2\pi`,
      intuition: 'Close to the data the band is narrow. Away from it the band widens back to the prior. The model knows where it doesn\'t know.',
      assumptions: ['A sensible kernel', 'Small data (inverting K is cubic)'],
      params: [['kernel', 'C·RBF + White', 'Shape and smoothness'], ['n_restarts_optimizer', '2 – 10', 'Escape bad local optima']],
      pros: ['Calibrated uncertainty', 'Works on tiny data', 'Kernels encode domain knowledge'], cons: [T`$O(n^3)$: hopeless beyond ~10k rows`, 'Kernel choice matters'],
      use: 'Small, expensive data (experiments, calibration runs, sensors) where error bars matter.', complexity: [T`O(n^3)`, T`O(n)\ \text{mean},\ O(n^2)\ \text{var}`], related: ['bayesridge', 'svm'] },
    { slug: 'bayesridge', name: 'Bayesian ridge', short: 'BayesR', family: 'prob', tasks: ['regression', 'forecast'], lib: 'scikit-learn', pip: ['scikit-learn'],
      power: 2.3, interp: 4.5, speed: 4.6, minRows: 'xs', maxRows: 'xl', cat: false, miss: false, ivals: true, global: true, scale: true, tmpl: 'tab',
      summary: 'Ridge regression where the penalty and the noise level are learned from the data, and predictions come with a standard deviation.',
      eq: T`\boldsymbol\beta \sim \mathcal N(\mathbf 0, \lambda^{-1}I),\quad y\mid\mathbf x,\boldsymbol\beta \sim \mathcal N(\mathbf x^\top\boldsymbol\beta, \alpha^{-1})`, eqNote: T`$\alpha, \lambda$ get Gamma hyperpriors and are fitted by evidence maximisation.`,
      obj: T`p(y_*\mid\mathbf x_*, \mathcal D) = \mathcal N\!\big(\mathbf x_*^\top\boldsymbol\mu,\ \alpha^{-1} + \mathbf x_*^\top\Sigma\,\mathbf x_*\big)`,
      intuition: 'Same predictions as a well-tuned ridge, plus an honest ± that grows for unusual inputs.',
      assumptions: ['Linear relationship', 'Gaussian noise'],
      params: [['alpha_1 … lambda_2', 'defaults (1e-6)', 'Gamma hyperpriors, rarely touched']],
      pros: ['No regularisation tuning', 'Prediction intervals'], cons: ['Still linear'],
      use: 'You want ridge plus uncertainty without a cross-validation loop.', complexity: [T`O(np^2 + p^3)`, T`O(p^2)`], related: ['ridge', 'gp'] },
    { slug: 'nb', name: 'Naive Bayes', short: 'NB', family: 'prob', tasks: CLF, lib: 'scikit-learn', pip: ['scikit-learn'],
      power: 1.8, interp: 4, speed: 5, minRows: 'xs', maxRows: 'xl', cat: false, miss: false, ivals: false, global: false, scale: false, tmpl: 'tab',
      summary: 'Bayes\' rule with the "naive" assumption that features are independent given the class. Absurdly fast and a fine baseline.',
      eq: T`P(y=k\mid\mathbf x) \propto P(y=k)\prod_{j=1}^p P(x_j\mid y=k)`, eqNote: T`Gaussian NB uses $x_j\mid y{=}k \sim \mathcal N(\mu_{jk}, \sigma^2_{jk})$.`,
      obj: '', intuition: 'Each feature votes independently, weighted by how typical its value is for each class. The independence assumption is wrong, and the class ranking often comes out right anyway.',
      assumptions: ['Conditional independence of features', 'Gaussian per-class features (GaussianNB)'],
      params: [['var_smoothing', '1e-9 – 1e-6', 'Numerical stability']],
      pros: ['Trains in one pass', 'Works on tiny data'], cons: ['Poorly calibrated probabilities', 'Ignores interactions'],
      use: 'A sanity-check classifier, or text classification with MultinomialNB.', complexity: [T`O(np)`, T`O(pk)`], related: ['logreg'] },

    /* ---------------------------------------------------------------- trees */
    { slug: 'tree', name: 'Decision tree', short: 'Tree', family: 'trees', tasks: ALL, lib: 'scikit-learn', pip: ['scikit-learn'],
      power: 2.3, interp: 4.6, speed: 4.8, minRows: 'xs', maxRows: 'xl', cat: false, miss: true, ivals: false, global: true, scale: false, tmpl: 'tab',
      summary: 'Recursively splits the data on one feature at a time, choosing the split that makes the children purest. The result reads as a flowchart.',
      eq: T`\hat f(\mathbf x) = \sum_{m=1}^{M} c_m\,\mathbb 1[\mathbf x \in R_m]`, eqNote: T`Each leaf region $R_m$ predicts a constant $c_m$.`,
      obj: T`\text{split}^* = \arg\max_{j,s}\ \Big[I(R) - \tfrac{|R_L|}{|R|}I(R_L) - \tfrac{|R_R|}{|R|}I(R_R)\Big],\quad I_{\text{Gini}} = 1-\textstyle\sum_k p_k^2`,
      intuition: '"If tickets > 3 and plan = basic then churn." You can print it and hang it on the wall.',
      assumptions: ['None about linearity', 'Axis-aligned structure'],
      params: [['max_depth', '3 – 12', 'Complexity'], ['min_samples_leaf', '5 – 100', 'Smoother leaves']],
      pros: ['Fully transparent', 'No scaling needed', 'Captures interactions'], cons: ['High variance: small data changes, different tree', 'Step-shaped predictions'],
      use: 'When the model itself is the explanation, or as a building block.', complexity: [T`O(np\log n)`, T`O(\text{depth})`], related: ['rf', 'extra', 'hgb'] },
    { slug: 'rf', name: 'Random forest', short: 'RF', family: 'trees', tasks: ALL, lib: 'scikit-learn', pip: ['scikit-learn'],
      power: 3.6, interp: 2.8, speed: 3.5, minRows: 'xs', maxRows: 'l', cat: false, miss: true, ivals: false, global: true, scale: false, tmpl: 'tab',
      summary: 'Hundreds of deep trees, each on a bootstrap sample and a random subset of features, averaged. Robust, hard to break, needs little tuning.',
      eq: T`\hat f(\mathbf x) = \frac1B\sum_{b=1}^{B} T_b(\mathbf x;\ \Theta_b)`, eqNote: T`Averaging $B$ trees with pairwise correlation $\rho$ gives variance $\rho\sigma^2 + \tfrac{1-\rho}{B}\sigma^2$, and feature subsampling lowers $\rho$.`,
      obj: '', intuition: 'Each tree overfits in its own way. The average cancels the quirks and keeps the signal: wisdom of a decorrelated crowd.',
      assumptions: ['Enough rows for bootstraps to differ'],
      params: [['n_estimators', '300 – 1000', 'More is better, slower'], ['max_features', 'sqrt | 0.3 – 0.7', 'Decorrelation'], ['min_samples_leaf', '1 – 20', 'Smoothing']],
      pros: ['Strong out of the box', 'Out-of-bag error for free', 'Rarely overfits badly'], cons: ['Large models', 'Can\'t extrapolate beyond seen targets', 'Usually a step behind boosting'],
      use: 'A strong, low-effort default for tabular data.', complexity: [T`O(B\,n\log n\,\sqrt p)`, T`O(B\cdot\text{depth})`], related: ['extra', 'hgb', 'lgbm'] },
    { slug: 'extra', name: 'Extra trees', short: 'ExtraT', family: 'trees', tasks: ALL, lib: 'scikit-learn', pip: ['scikit-learn'],
      power: 3.5, interp: 2.6, speed: 4, minRows: 'xs', maxRows: 'l', cat: false, miss: true, ivals: false, global: true, scale: false, tmpl: 'tab',
      summary: 'Extremely randomised trees: like a random forest, but split thresholds are drawn at random. Faster to train, smoother, lower variance.',
      eq: T`\hat f(\mathbf x) = \frac1B\sum_{b} T_b(\mathbf x),\quad s_j \sim \mathcal U\big(\min x_j, \max x_j\big)`, eqNote: 'For each candidate feature a random cut point is drawn, and the best of those random cuts is used.',
      obj: '', intuition: 'Random thresholds add bias but remove a lot of variance. On noisy data that trade often pays.',
      assumptions: ['As random forest'],
      params: [['n_estimators', '300 – 1000', ''], ['max_features', '0.3 – 1.0', '']],
      pros: ['Faster than RF', 'Smoother predictions'], cons: ['Similar limits to RF'],
      use: 'Noisy targets, or when RF is too slow.', complexity: [T`O(B\,n\,\sqrt p\,\text{depth})`, T`O(B\cdot\text{depth})`], related: ['rf'] },

    /* ---------------------------------------------------------------- boosting */
    { slug: 'hgb', name: 'Histogram gradient boosting', short: 'HGB', family: 'boosting', tasks: ALL, lib: 'scikit-learn', pip: ['scikit-learn'],
      power: 4.2, interp: 2.4, speed: 4.3, minRows: 's', maxRows: 'xl', cat: true, miss: true, ivals: false, global: true, scale: false, tmpl: 'tab',
      summary: 'scikit-learn\'s LightGBM-style booster: binned features, native missing values and categoricals, early stopping. No extra dependency.',
      eq: T`F_M(\mathbf x) = F_0 + \nu\sum_{m=1}^{M} h_m(\mathbf x),\qquad h_m \approx -\left.\frac{\partial \ell(y, F)}{\partial F}\right|_{F_{m-1}}`, eqNote: T`$\nu$ is the learning rate; each tree $h_m$ fits the negative gradient (for squared loss, the residuals).`,
      obj: T`\min_{F}\ \sum_i \ell\big(y_i, F(\mathbf x_i)\big) + \text{regularisation}`,
      intuition: 'Gradient descent where each step is a small tree. Every tree corrects what the previous ones got wrong.',
      assumptions: ['Enough rows to support many trees (early stopping helps)'],
      params: [['learning_rate', '0.02 – 0.2', 'Step size'], ['max_iter', '200 – 2000', 'Trees (with early stopping)'], ['max_leaf_nodes', '15 – 63', 'Tree size'], ['l2_regularization', '0 – 10', '']],
      pros: ['Boosting-grade accuracy in pure scikit-learn', 'Handles NaN and categoricals'], cons: ['Fewer knobs than LightGBM', 'No sparse input'],
      use: 'Boosting without installing anything beyond scikit-learn.', complexity: [T`O(M\,n\,p)`, T`O(M\cdot\text{depth})`], related: ['lgbm', 'xgb', 'catboost'] },
    { slug: 'xgb', name: 'XGBoost', short: 'XGB', family: 'boosting', tasks: ALL, lib: 'xgboost', pip: ['xgboost'],
      power: 4.5, interp: 2.2, speed: 3.8, minRows: 's', maxRows: 'xl', cat: false, miss: true, ivals: false, global: true, scale: false, tmpl: 'tab',
      summary: 'Regularised gradient boosting with a second-order (Newton) objective. A long-running Kaggle favourite, and a solid default for tabular data.',
      eq: T`\hat y_i = \sum_{k=1}^{K} f_k(\mathbf x_i),\qquad \Omega(f) = \gamma T + \tfrac12\lambda\lVert\mathbf w\rVert^2`, eqNote: T`$T$ = number of leaves, $\mathbf w$ = leaf weights.`,
      obj: T`\mathcal L^{(t)} \approx \sum_i \big[g_i f_t(\mathbf x_i) + \tfrac12 h_i f_t^2(\mathbf x_i)\big] + \Omega(f_t),\quad w_j^* = -\frac{\sum_{i\in I_j} g_i}{\sum_{i\in I_j} h_i + \lambda}`,
      intuition: 'A Taylor expansion of the loss to second order gives closed-form optimal leaf weights and a split gain formula. The penalty prunes splits that don\'t pay for themselves.',
      assumptions: ['Enough rows; tune regularisation on small data'],
      params: [['n_estimators', '300 – 3000', 'With early stopping'], ['learning_rate', '0.01 – 0.2', ''], ['max_depth', '3 – 10', ''], ['subsample / colsample_bytree', '0.6 – 1.0', 'Stochasticity'], ['reg_lambda', '0 – 10', 'L2 on leaf weights']],
      pros: ['Top-tier accuracy', 'Missing values handled', 'GPU support'], cons: ['Many hyperparameters', 'Needs care to avoid overfitting'],
      use: 'You want maximum tabular accuracy and are willing to tune.', complexity: [T`O(K\,n\,p)`, T`O(K\cdot\text{depth})`], related: ['lgbm', 'catboost', 'hgb'] },
    { slug: 'lgbm', name: 'LightGBM', short: 'LGBM', family: 'boosting', tasks: ALL, lib: 'lightgbm', pip: ['lightgbm'],
      power: 4.6, interp: 2.2, speed: 4.5, minRows: 's', maxRows: 'xl', cat: true, miss: true, ivals: false, global: true, scale: false, tmpl: 'tab',
      summary: 'Leaf-wise, histogram-based gradient boosting. Very fast on large data, and the usual choice for global forecasting models over thousands of series.',
      eq: T`F_M(\mathbf x) = \sum_{m=1}^M \nu\,h_m(\mathbf x)`, eqNote: 'Trees grow leaf-wise (best-first) rather than level-wise. GOSS and EFB speed up training on big, sparse data.',
      obj: T`\text{Gain} = \tfrac12\Big[\frac{G_L^2}{H_L+\lambda} + \frac{G_R^2}{H_R+\lambda} - \frac{(G_L+G_R)^2}{H_L+H_R+\lambda}\Big] - \gamma`,
      intuition: 'Growing the leaf with the biggest loss reduction first gives deeper, more accurate trees per unit of compute. Watch num_leaves on small data.',
      assumptions: ['Enough rows: leaf-wise growth overfits tiny data'],
      params: [['num_leaves', '15 – 255', 'Main complexity knob'], ['learning_rate', '0.01 – 0.1', ''], ['n_estimators', '500 – 5000', 'With early stopping'], ['min_child_samples', '10 – 200', 'Leaf size'], ['feature_fraction / bagging_fraction', '0.6 – 0.9', '']],
      pros: ['Fastest of the big boosters', 'Native categoricals', 'The go-to for lag-feature forecasting'], cons: ['Overfits small data without care'],
      use: 'Big tabular data, and global ML forecasting across many series with lag features.', complexity: [T`O(M\,n\,p)\ \text{(histograms)}`, T`O(M\cdot\text{depth})`], related: ['xgb', 'catboost', 'qgbm'] },
    { slug: 'catboost', name: 'CatBoost', short: 'CatB', family: 'boosting', tasks: ALL, lib: 'catboost', pip: ['catboost'],
      power: 4.6, interp: 2.3, speed: 3.2, minRows: 'xs', maxRows: 'xl', cat: true, miss: true, ivals: false, global: true, scale: false, tmpl: 'tab',
      summary: 'Boosting with ordered target statistics for categorical features and symmetric trees. Excellent defaults, and the best with many high-cardinality categoricals.',
      eq: T`\hat x_{i}^{(j)} = \frac{\sum_{r<i} \mathbb 1[x_r^{(j)} = x_i^{(j)}]\,y_r + a\,p}{\sum_{r<i}\mathbb 1[x_r^{(j)} = x_i^{(j)}] + a}`, eqNote: T`Each categorical value becomes a smoothed target mean computed only from rows before it in a random permutation. That is how it avoids target leakage. $p$ is a prior, $a$ its weight.`,
      obj: T`\text{Ordered boosting: } r_i = y_i - F^{(\sigma, i-1)}(\mathbf x_i)`,
      intuition: 'Target encoding done properly, built into the booster. Symmetric (oblivious) trees act as a strong regulariser and predict very fast.',
      assumptions: ['None special; strong defaults'],
      params: [['iterations', '500 – 5000', ''], ['learning_rate', '0.02 – 0.1', ''], ['depth', '4 – 10', 'Symmetric tree depth'], ['l2_leaf_reg', '1 – 10', '']],
      pros: ['Best-in-class categoricals', 'Great defaults', 'Text features supported'], cons: ['Slower training', 'Bigger install'],
      use: 'Many categorical columns (ids, regions, products), or when you want good results without tuning.', complexity: [T`O(M\,n\,p)`, T`O(M\cdot\text{depth})`], related: ['lgbm', 'xgb'] },
    { slug: 'qgbm', name: 'Quantile gradient boosting', short: 'QGB', family: 'boosting', tasks: ['regression', 'forecast'], lib: 'lightgbm', pip: ['lightgbm'],
      power: 4.2, interp: 2.4, speed: 4.2, minRows: 's', maxRows: 'xl', cat: true, miss: true, ivals: true, global: true, scale: false, tmpl: 'tab',
      summary: 'LightGBM trained on the pinball loss at several quantiles (P10, P50, P90). You get the median forecast and an 80% band.',
      eq: T`\hat q_\tau(\mathbf x) = \arg\min_q\ \mathbb E\big[\rho_\tau(y - q)\big],\qquad \rho_\tau(u) = u\big(\tau - \mathbb 1[u<0]\big)`, eqNote: T`One model per $\tau \in \{0.1, 0.5, 0.9\}$.`,
      obj: T`\min_F \sum_i \rho_\tau\big(y_i - F(\mathbf x_i)\big)`,
      intuition: 'Penalise under-prediction with weight τ and over-prediction with weight 1−τ, and the optimum is the τ-quantile. No distributional assumption needed.',
      assumptions: ['Enough data in the tails for extreme quantiles'],
      params: [['alpha (τ)', '0.05 – 0.95', 'Which quantile'], ['num_leaves, learning_rate', 'as LightGBM', '']],
      pros: ['Distribution-free intervals', 'Asymmetric costs (stock-outs vs. waste)'], cons: ['Quantiles can cross (sort them)', 'Three models to train'],
      use: 'Inventory and capacity decisions where over- and under-forecasting cost different amounts.', complexity: [T`3 \times O(M\,n\,p)`, T`3 \times O(M\cdot\text{depth})`], related: ['lgbm'] },

    /* ---------------------------------------------------------------- neural */
    { slug: 'mlp', name: 'Multilayer perceptron', short: 'MLP', family: 'neural', tasks: ALL, lib: 'scikit-learn', pip: ['scikit-learn'],
      power: 3.4, interp: 1.5, speed: 2.8, minRows: 's', maxRows: 'l', cat: false, miss: false, ivals: false, global: true, scale: true, tmpl: 'tab',
      summary: 'Fully connected layers with non-linear activations, trained by back-propagation. A universal approximator, with the usual caveats.',
      eq: T`\mathbf h^{(\ell)} = \phi\big(W^{(\ell)}\mathbf h^{(\ell-1)} + \mathbf b^{(\ell)}\big),\qquad \hat y = W^{(L)}\mathbf h^{(L-1)} + b^{(L)}`, eqNote: T`$\phi$ = ReLU; trained with Adam on mini-batches.`,
      obj: T`\min_{\theta}\ \tfrac1n\sum_i \ell\big(y_i, f_\theta(\mathbf x_i)\big) + \alpha\lVert\theta\rVert_2^2`,
      intuition: 'Each layer learns a new set of features from the previous one. On tabular data boosting usually wins, but an MLP adds diversity to an ensemble.',
      assumptions: ['Scaled inputs', 'Enough data'],
      params: [['hidden_layer_sizes', '(64,) – (256, 128)', 'Capacity'], ['alpha', '1e-5 – 1e-2', 'L2'], ['learning_rate_init', '1e-4 – 1e-2', '']],
      pros: ['Smooth function approximation', 'Extends to embeddings, multi-output'], cons: ['Sensitive to scaling and seeds', 'Opaque'],
      use: 'Smooth, high-dimensional numeric problems, or as an ensemble member.', complexity: [T`O(n\,\text{epochs}\,\textstyle\sum_\ell d_\ell d_{\ell-1})`, T`O(\textstyle\sum_\ell d_\ell d_{\ell-1})`], related: ['lstm', 'svm'] },
    { slug: 'lstm', name: 'LSTM', short: 'LSTM', family: 'neural', tasks: ['forecast'], lib: 'PyTorch', pip: ['torch'],
      power: 4, interp: 1.2, speed: 1.5, minRows: 'm', maxRows: 'xl', cat: false, miss: false, ivals: false, global: true, scale: true, tmpl: 'torch',
      summary: 'A recurrent network with gated memory cells that read a window of the past and output the next h steps at once.',
      eq: T`\begin{aligned} \mathbf c_t &= \mathbf f_t\odot\mathbf c_{t-1} + \mathbf i_t\odot\tanh(W_c[\mathbf h_{t-1},\mathbf x_t]+\mathbf b_c)\\ \mathbf h_t &= \mathbf o_t\odot\tanh(\mathbf c_t),\quad \mathbf f_t,\mathbf i_t,\mathbf o_t = \sigma(W_{\{f,i,o\}}[\mathbf h_{t-1},\mathbf x_t]+\mathbf b) \end{aligned}`, eqNote: 'The forget gate f decides what to keep. The additive cell update lets gradients flow over long spans.',
      obj: T`\min_\theta \sum_{\text{windows}} \tfrac1h\sum_{k=1}^{h}\big(y_{t+k} - \hat y_{t+k}\big)^2`,
      intuition: 'It reads the recent past like a sentence and keeps a running memory of what matters (the trend, where you are in the season).',
      assumptions: ['Many windows: long series or many related series', 'Scaled inputs'],
      params: [['lookback window', '2–4 × season', 'How far back it reads'], ['hidden size', '32 – 256', ''], ['layers', '1 – 3', ''], ['dropout', '0 – 0.3', '']],
      pros: ['Learns temporal patterns directly', 'One model for many series'], cons: ['Data-hungry', 'Slow to train', 'Often beaten by LightGBM with lags'],
      use: 'Long, high-frequency series (hourly energy, sensors), or thousands of related series.', complexity: [T`O(n\,L\,d^2\,\text{epochs})`, T`O(L\,d^2)`], related: ['gru', 'tcn', 'transformer'] },
    { slug: 'gru', name: 'GRU', short: 'GRU', family: 'neural', tasks: ['forecast'], lib: 'PyTorch', pip: ['torch'],
      power: 4, interp: 1.2, speed: 1.7, minRows: 'm', maxRows: 'xl', cat: false, miss: false, ivals: false, global: true, scale: true, tmpl: 'torch',
      summary: 'A leaner recurrent unit with two gates instead of three. Usually as accurate as an LSTM, and faster.',
      eq: T`\mathbf h_t = (1-\mathbf z_t)\odot\mathbf h_{t-1} + \mathbf z_t\odot\tanh\big(W[\mathbf r_t\odot\mathbf h_{t-1}, \mathbf x_t]\big)`, eqNote: T`$\mathbf z_t$ = update gate, $\mathbf r_t$ = reset gate.`,
      obj: T`\min_\theta \sum \lVert \mathbf y_{t+1:t+h} - \hat{\mathbf y}_{t+1:t+h}\rVert_2^2`,
      intuition: 'One gate interpolates between keeping the old memory and writing a new one.',
      assumptions: ['As LSTM'], params: [['hidden size', '32 – 256', ''], ['layers', '1 – 3', '']],
      pros: ['Fewer parameters than LSTM', 'Trains faster'], cons: ['As LSTM'],
      use: 'Same jobs as an LSTM when you want a quicker experiment.', complexity: [T`O(n\,L\,d^2\,\text{epochs})`, T`O(L\,d^2)`], related: ['lstm', 'tcn'] },
    { slug: 'tcn', name: 'Temporal convolutional network', short: 'TCN', family: 'neural', tasks: ['forecast'], lib: 'PyTorch', pip: ['torch'],
      power: 4, interp: 1.3, speed: 2, minRows: 'm', maxRows: 'xl', cat: false, miss: false, ivals: false, global: true, scale: true, tmpl: 'torch',
      summary: 'Stacked causal, dilated 1-D convolutions. Parallel to train, with a receptive field that grows exponentially with depth.',
      eq: T`(\mathbf x *_d \mathbf f)(t) = \sum_{i=0}^{k-1} f(i)\,\mathbf x_{t - d\cdot i},\qquad d_\ell = 2^\ell`, eqNote: T`Receptive field $= 1 + (k-1)\sum_\ell d_\ell$: 4 layers of kernel 3 already see 31 steps.`,
      obj: T`\min_\theta \sum \lVert \mathbf y_{t+1:t+h} - \hat{\mathbf y}_{t+1:t+h}\rVert_2^2`,
      intuition: 'Pattern detectors slid along time. Dilation lets the top layers see weeks while the bottom layers see hours.',
      assumptions: ['As LSTM'], params: [['channels', '32 – 128', ''], ['kernel size', '2 – 7', ''], ['levels', '3 – 8', 'Receptive field']],
      pros: ['Trains in parallel (fast on GPU)', 'Stable gradients'], cons: ['Fixed receptive field', 'Data-hungry'],
      use: 'Long sequences where RNNs are slow to train.', complexity: [T`O(n\,L\,k\,c^2\,\text{levels})`, T`O(L\,k\,c^2)`], related: ['lstm', 'transformer'] },
    { slug: 'transformer', name: 'Transformer encoder', short: 'Transf', family: 'neural', tasks: ['forecast'], lib: 'PyTorch', pip: ['torch'],
      power: 4.2, interp: 1.1, speed: 1.2, minRows: 'l', maxRows: 'xl', cat: false, miss: false, ivals: false, global: true, scale: true, tmpl: 'torch',
      summary: 'Self-attention over the lookback window: every time step attends to every other. The engine behind TFT, PatchTST and the time-series foundation models.',
      eq: T`\operatorname{Attention}(Q,K,V) = \operatorname{softmax}\!\Big(\frac{QK^\top}{\sqrt{d_k}}\Big)V`, eqNote: 'Positional embeddings tell it the order. Multi-head attention runs several of these in parallel.',
      obj: T`\min_\theta \sum \lVert \mathbf y_{t+1:t+h} - \hat{\mathbf y}_{t+1:t+h}\rVert_2^2`,
      intuition: 'For each step it asks: "which past moments look relevant to me?" and mixes them by that relevance.',
      assumptions: ['Lots of data', 'Careful regularisation'],
      params: [['d_model', '32 – 256', ''], ['heads', '2 – 8', ''], ['layers', '1 – 4', ''], ['dropout', '0.1 – 0.3', '']],
      pros: ['Long-range dependencies', 'Scales with data'], cons: [T`$O(L^2)$ attention cost`, 'Easy to overfit on small data'],
      use: 'Large collections of long series; or start from a pretrained foundation model.', complexity: [T`O(n\,L^2 d\,\text{epochs})`, T`O(L^2 d)`], related: ['tcn', 'lstm'] },

    /* ---------------------------------------------------------------- classical */
    { slug: 'arima', name: 'ARIMA / SARIMAX', short: 'SARIMA', family: 'classical', tasks: ['forecast'], lib: 'statsmodels', pip: ['statsmodels'],
      power: 3, interp: 4, speed: 3.2, minRows: 'xs', maxRows: 'l', cat: false, miss: false, ivals: true, global: false, scale: false, tmpl: 'stat',
      summary: 'Autoregression on differenced values plus moving-average error terms, with seasonal versions of both. Known-ahead drivers enter as exogenous regressors.',
      eq: T`\phi_p(B)\,\Phi_P(B^m)\,(1-B)^d(1-B^m)^D\,y_t = \boldsymbol\beta^\top\mathbf x_t + \theta_q(B)\,\Theta_Q(B^m)\,\varepsilon_t`, eqNote: T`$B$ is the backshift operator, $By_t = y_{t-1}$. $(p,d,q)(P,D,Q)_m$ are the orders.`,
      obj: T`\max\ \log L(\phi,\theta,\Phi,\Theta,\sigma^2\mid y)\quad\text{(Kalman filter, exact likelihood)}`,
      intuition: 'Difference the series until it is stationary, then explain today by yesterday (AR) and by yesterday\'s surprise (MA). The seasonal terms do the same one season back.',
      assumptions: ['Stationary after differencing', 'Linear dynamics', 'Gaussian errors (for intervals)'],
      params: [['(p, d, q)', '(0–3, 0–2, 0–3)', 'Non-seasonal orders'], ['(P, D, Q, m)', '(0–2, 0–1, 0–2, season)', 'Seasonal orders'], ['exog', 'known-ahead drivers', 'SARIMAX regressors']],
      pros: ['Principled intervals', 'Interpretable dynamics', 'Great on short single series'], cons: ['One model per series', 'Slow with long seasons (hourly, m = 24 or 168)', 'Order selection takes care'],
      use: 'A handful of monthly or quarterly series with clear autocorrelation.', complexity: [T`O(n\,(p+q+mP+mQ)^2)`, T`O(h)`], related: ['ets', 'theta', 'prophet'] },
    { slug: 'ets', name: 'Exponential smoothing (ETS)', short: 'ETS', family: 'classical', tasks: ['forecast'], lib: 'statsmodels', pip: ['statsmodels'],
      power: 3, interp: 4.4, speed: 4.2, minRows: 'xs', maxRows: 'l', cat: false, miss: false, ivals: true, global: false, scale: false, tmpl: 'stat',
      summary: 'Holt–Winters as a state-space model: an exponentially weighted level, a (damped) trend and a seasonal component, each updated as data arrives.',
      eq: T`\begin{aligned} \ell_t &= \alpha(y_t - s_{t-m}) + (1-\alpha)(\ell_{t-1} + \phi b_{t-1})\\ b_t &= \beta(\ell_t - \ell_{t-1}) + (1-\beta)\phi b_{t-1}\\ s_t &= \gamma(y_t - \ell_t) + (1-\gamma)s_{t-m}\\ \hat y_{t+h\mid t} &= \ell_t + (\phi+\dots+\phi^h)\,b_t + s_{t+h-m\lceil h/m\rceil} \end{aligned}`, eqNote: T`$\phi < 1$ damps the trend so long-range forecasts flatten out sensibly.`,
      obj: T`\max\ \log L(\alpha,\beta,\gamma,\phi,\ell_0,b_0,s_{0})`,
      intuition: 'Recent observations count more, and the weights decay geometrically into the past. Level, trend and season each get their own memory length.',
      assumptions: ['Stable seasonal shape', 'No external drivers (pure univariate)'],
      params: [['trend', 'add | None (damped)', ''], ['seasonal', 'add | mul | None', ''], ['seasonal_periods', 'season length', '']],
      pros: ['Fast and robust', 'Readable components', 'Strong in forecasting competitions'], cons: ['Can\'t use drivers', 'One model per series'],
      use: 'Many short business series with trend and seasonality, no external drivers.', complexity: [T`O(n\cdot\text{iters})`, T`O(h)`], related: ['theta', 'arima', 'naive'] },
    { slug: 'theta', name: 'Theta method', short: 'Theta', family: 'classical', tasks: ['forecast'], lib: 'statsmodels', pip: ['statsmodels'],
      power: 2.9, interp: 4.3, speed: 4.6, minRows: 'xs', maxRows: 'xl', cat: false, miss: false, ivals: true, global: false, scale: false, tmpl: 'stat',
      summary: 'Winner of the M3 competition: deseasonalise, then combine simple exponential smoothing with half the slope of a linear trend.',
      eq: T`\hat y_{T+h\mid T} = \tilde\ell_T + \tfrac{1}{2}\hat b_0\Big(h - 1 + \tfrac1\alpha - \tfrac{(1-\alpha)^T}{\alpha}\Big)`, eqNote: T`Equivalent to SES with drift. $\hat b_0$ is the OLS trend slope, $\tilde\ell_T$ the SES level.`,
      obj: '', intuition: 'Split the series into a long-term line and a short-term wiggle, forecast each the simple way, and recombine.',
      assumptions: ['Roughly linear trend', 'Multiplicative seasonality (removed first)'],
      params: [['period', 'season length', 'Deseasonalising'], ['theta', '2 (classic)', 'Weight on curvature']],
      pros: ['Very fast', 'Very hard to beat on short series'], cons: ['No drivers', 'Linear-trend assumption'],
      use: 'Thousands of short monthly or quarterly series where you need a robust automatic forecast.', complexity: [T`O(n)`, T`O(h)`], related: ['ets', 'naive'] },
    { slug: 'prophet', name: 'Prophet', short: 'Prophet', family: 'classical', tasks: ['forecast'], lib: 'prophet', pip: ['prophet'],
      power: 3.1, interp: 4.2, speed: 3.5, minRows: 'xs', maxRows: 'l', cat: false, miss: true, ivals: true, global: false, scale: false, tmpl: 'prophet',
      summary: 'A decomposable regression: a piecewise-linear trend with automatic changepoints, Fourier seasonalities, holidays and extra regressors, fitted with Stan.',
      eq: T`y(t) = g(t) + s(t) + h(t) + \boldsymbol\beta^\top\mathbf x(t) + \varepsilon_t,\qquad s(t) = \sum_{n=1}^{N}\Big[a_n\cos\tfrac{2\pi n t}{P} + b_n\sin\tfrac{2\pi n t}{P}\Big]`, eqNote: T`$g$ = trend with changepoints (Laplace prior), $h$ = holiday effects, $P$ = period (7, 365.25).`,
      obj: T`\text{MAP estimate with priors: } \delta_j \sim \operatorname{Laplace}(0, \tau),\ a_n, b_n \sim \mathcal N(0, \sigma_s^2)`,
      intuition: 'Curve-fitting, not dynamics: trend plus seasonal waves plus special days. It handles gaps and outliers gracefully, and the components plot explains itself.',
      assumptions: ['Strong, regular seasonality', 'Several seasons of history'],
      params: [['changepoint_prior_scale', '0.001 – 0.5', 'Trend flexibility'], ['seasonality_prior_scale', '0.01 – 10', ''], ['seasonality_mode', 'additive | multiplicative', '']],
      pros: ['Analyst-friendly', 'Missing data OK', 'Holidays and regressors built in'], cons: ['Often beaten by ETS or boosting on accuracy', 'One model per series'],
      use: 'Daily business metrics with strong weekly and yearly patterns and known events.', complexity: [T`O(n\cdot\text{iters})`, T`O(h)`], related: ['ets', 'arima'] },
    { slug: 'var', name: 'Vector autoregression', short: 'VAR', family: 'classical', tasks: ['forecast'], lib: 'statsmodels', pip: ['statsmodels'],
      power: 2.8, interp: 3.8, speed: 4, minRows: 'xs', maxRows: 'l', cat: false, miss: false, ivals: true, global: false, scale: false, tmpl: 'var',
      summary: 'Several numeric series forecast jointly: each one is regressed on the recent past of all of them.',
      eq: T`\mathbf y_t = \mathbf c + \sum_{i=1}^{p} A_i\,\mathbf y_{t-i} + \boldsymbol\varepsilon_t,\qquad \boldsymbol\varepsilon_t \sim \mathcal N(\mathbf 0, \Sigma)`, eqNote: T`$A_i$ are $k\times k$ matrices; the lag order $p$ is chosen by AIC.`,
      obj: T`\hat A = \arg\min \sum_t \lVert \mathbf y_t - \mathbf c - \textstyle\sum_i A_i \mathbf y_{t-i}\rVert^2 \quad\text{(equation-by-equation OLS)}`,
      intuition: 'Does yesterday\'s ad spend move today\'s sales, and vice versa? VAR models those cross-effects (Granger causality, impulse responses).',
      assumptions: ['All series stationary (difference first)', 'Linear interactions', 'Few variables (parameters grow as k²p)'],
      params: [['maxlags', 'up to one season', 'Searched by information criterion'], ['ic', 'aic | bic', '']],
      pros: ['Models feedback between variables', 'Impulse-response analysis'], cons: ['Parameter explosion', 'Needs every variable forecast together'],
      use: 'A few interacting macro or business indicators.', complexity: [T`O(n\,(kp)^2)`, T`O(h\,k^2p)`], related: ['arima'] },

    /* ---------------------------------------------------------------- more neural forecasters */
    { slug: 'nbeats', name: 'N-BEATS', short: 'NBEATS', family: 'neural', tasks: ['forecast'], lib: 'PyTorch', pip: ['torch'],
      power: 4.2, interp: 1.8, speed: 2.4, minRows: 'm', maxRows: 'xl', cat: false, miss: false, ivals: false, global: true, scale: true, tmpl: 'torch',
      summary: 'Deep stacks of fully connected blocks. Each block forecasts part of the future and subtracts what it explained from its input, so the next block works on the remainder. No recurrence, no attention.',
      eq: T`\begin{aligned} \mathbf h_\ell &= \mathrm{FC}^{4}_\ell(\mathbf x_\ell),\qquad \hat{\mathbf x}_\ell = V^{b}_\ell\,\mathbf h_\ell,\qquad \hat{\mathbf y}_\ell = V^{f}_\ell\,\mathbf h_\ell\\ \mathbf x_{\ell+1} &= \mathbf x_\ell - \hat{\mathbf x}_\ell,\qquad \hat{\mathbf y} = \textstyle\sum_\ell \hat{\mathbf y}_\ell \end{aligned}`,
      eqNote: T`$\mathbf x_1$ is the lookback window of the target. Block $\ell$ explains a "backcast" $\hat{\mathbf x}_\ell$ of its input and adds a partial forecast $\hat{\mathbf y}_\ell$. The interpretable variant fixes $V$ to a polynomial (trend) or Fourier (seasonality) basis.`,
      obj: T`\min_\theta \sum_{\text{windows}} \tfrac1h\textstyle\sum_{k=1}^{h} \ell_\delta\big(y_{t+k} - \hat y_{t+k}\big)`,
      intuition: 'Doubly residual: the input path peels off what each block explained, the output path adds up the partial forecasts. Like boosting, but inside one network trained end to end. Drivers enter as extra inputs to every block (the NBEATSx idea).',
      assumptions: ['Many training windows: long series or many related series', 'Scaled inputs'],
      params: [['blocks', '3 – 30', 'Depth of the residual stack'], ['width', '256 – 512', 'Units per fully connected layer'], ['lookback', '2 – 7 × horizon', 'Input window']],
      pros: ['Strong accuracy from a simple architecture', 'Fast to train: no recurrence', 'Interpretable variant splits trend and seasonality'], cons: ['Data-hungry', 'Point forecasts (intervals by conformal here)', 'Horizon fixed at training time'],
      use: 'Many related series with plenty of history, when you want a strong deep model that trains quickly.', complexity: [T`O(n\,B\,(L+h)\,d\,\text{epochs})`, T`O(B\,d^2)`], related: ['tft', 'tcn', 'lstm'] },
    { slug: 'tft', name: 'Temporal Fusion Transformer', short: 'TFT', family: 'neural', tasks: ['forecast'], lib: 'PyTorch', pip: ['torch'],
      power: 4.4, interp: 2.2, speed: 1.1, minRows: 'l', maxRows: 'xl', cat: false, miss: false, ivals: true, global: true, scale: true, tmpl: 'torch',
      summary: 'Variable-selection networks pick the useful inputs, an LSTM encoder–decoder reads the past and the known future, and interpretable attention looks back over the whole window. It outputs quantiles directly.',
      eq: T`\tilde H = \tfrac1m\sum_{j=1}^{m}\operatorname{softmax}\!\Big(\frac{Q W_Q^{(j)}\,(K W_K^{(j)})^\top}{\sqrt{d}}\Big)\,V W_V,\qquad \operatorname{GRN}(\mathbf a) = \operatorname{LayerNorm}\big(\mathbf a + \operatorname{GLU}(W_1\operatorname{ELU}(W_2\mathbf a + \mathbf b_2) + \mathbf b_1)\big)`,
      eqNote: T`The heads share one value projection $W_V$, so the averaged attention weights show which past steps mattered. Gated residual networks (GRN) can switch a whole component off when it doesn't help.`,
      obj: T`\min_\theta \sum_t\sum_{\tau\in\{0.1,\,0.5,\,0.9\}}\sum_{k=1}^{h}\rho_\tau\big(y_{t+k} - \hat q_\tau(t,k)\big)`,
      intuition: 'Built for the real forecasting setup: some inputs are known only in the past, some are known ahead (calendar, promos). Variable-selection weights and attention weights double as explanations.',
      assumptions: ['Lots of windows: tens of thousands', 'A GPU helps a lot'],
      params: [['hidden size', '16 – 256', 'Width of every GRN'], ['attention heads', '1 – 4', ''], ['dropout', '0.1 – 0.3', ''], ['quantiles', '0.1, 0.5, 0.9', 'Outputs and loss']],
      pros: ['Quantile forecasts built in', 'Treats past-only and known-future inputs differently', 'Variable weights and attention explain it'], cons: ['Heavy to train', 'Many moving parts', 'Overkill for a few short series'],
      use: 'Many series with rich drivers (promos, prices, weather) when you need probabilistic forecasts and some explanation.', complexity: [T`O(n\,(L+h)^2 d\,\text{epochs})`, T`O((L+h)^2 d)`], related: ['transformer', 'lstm', 'nbeats'] },

    /* ---------------------------------------------------------------- foundation models (zero-shot) */
    { slug: 'chronos', name: 'Chronos-2', short: 'Chronos', family: 'foundation', tasks: ['forecast'], lib: 'chronos-forecasting', pip: ['chronos-forecasting'],
      power: 4.3, interp: 1.5, speed: 3.6, minRows: 'xs', maxRows: 'xl', cat: false, miss: true, ivals: true, global: true, scale: false, tmpl: 'fm',
      summary: 'Amazon\'s pretrained forecaster. It reads the history of every series, plus past-only and known-ahead covariates, and returns quantile forecasts without any training on your data.',
      eq: T`\hat q_\tau(T{+}1{:}T{+}h) = f_\theta\big(\operatorname{patch}(\tilde{\mathbf y}_{1:T}),\ \tilde{\mathbf X}_{1:T+h}\big),\qquad \tilde y_t = \frac{y_t - \mu}{\sigma}`,
      eqNote: 'An encoder-only transformer over patches of the scaled history. Group attention lets the target, its covariates and (with cross-learning) related series share information. Many quantiles come out at once.',
      obj: T`\min_\theta\ \mathbb E_{\text{series}\sim\mathcal D_{\text{pretrain}}}\sum_\tau\sum_{k=1}^{h}\rho_\tau\big(y_{T+k} - \hat q_\tau(T{+}k)\big)\quad\text{(done once, by Amazon)}`,
      intuition: 'Like a language model that has read a vast number of time series. It recognises level, trend and seasonal shapes in your history and continues them. You only run inference.',
      assumptions: ['Your series look like the kinds it was pretrained on', 'Regular timestamps without gaps'],
      params: [['model', 'amazon/chronos-2 | chronos-bolt-small', 'Covariates vs. a smaller univariate model'], ['context_length', 'model default', 'How much history it reads'], ['cross_learning', 'False | True', 'Share information across series']],
      pros: ['No training: forecasts in seconds', 'Quantiles out of the box', 'Uses covariates and related series'], cons: ['Downloads ~0.5 GB of weights once', 'Fine-tuning is possible but not in this listing', 'Can\'t learn a pattern your history doesn\'t show'],
      use: 'A strong first forecast in minutes, a benchmark for your own models, or many series with little history each.', complexity: [T`0\ \text{(no training)}`, T`O(L^2 d)`], related: ['timesfm', 'transformer', 'naive'] },
    { slug: 'timesfm', name: 'TimesFM 2.5', short: 'TimesFM', family: 'foundation', tasks: ['forecast'], lib: 'timesfm', pip: ['timesfm'],
      power: 4.2, interp: 1.4, speed: 3.4, minRows: 'xs', maxRows: 'xl', cat: false, miss: true, ivals: true, global: true, scale: false, tmpl: 'fm',
      summary: 'Google\'s decoder-only foundation model (200M parameters). It reads up to 16k past steps of each series and forecasts the mean plus deciles, zero-shot.',
      eq: T`\mathbf o_j = \operatorname{Transformer}_{\text{causal}}\big(\operatorname{Res}(\tilde{\mathbf y}_{P(j-1)+1:Pj})\big),\qquad \hat{\mathbf y}_{Pj+1:Pj+H_o} = \operatorname{Res}(\mathbf o_j)`,
      eqNote: T`Input patches of $P = 32$ steps; each output token predicts a longer patch of $H_o$ steps, so long horizons need few autoregressive steps. A separate head gives continuous quantiles.`,
      obj: T`\min_\theta\ \sum_{\text{patches}} \tfrac{1}{H_o}\lVert \mathbf y - \hat{\mathbf y}\rVert_2^2 + \text{quantile loss}\quad\text{(pretraining)}`,
      intuition: 'A GPT for numbers: it reads your history in chunks and writes the next chunk. Pretraining on a very large corpus of real and synthetic series gives it a feel for typical patterns.',
      assumptions: ['Univariate here (covariates need its XReg extra)', 'Enough history for the patterns to show'],
      params: [['max_context', '512 – 16384', 'History it reads'], ['max_horizon', '≥ your horizon', ''], ['use_continuous_quantile_head', 'True', 'Quantile forecasts']],
      pros: ['Zero-shot, long contexts', 'Apache-2.0 weights (version 2.5)', 'Fast batched inference'], cons: ['Ignores your drivers in this listing', 'Large download', 'TimesFM 3.0 weights are non-commercial only'],
      use: 'Long univariate histories (hourly, daily) when you want a strong forecast without building a model.', complexity: [T`0\ \text{(no training)}`, T`O(L^2 d / P^2)`], related: ['chronos', 'transformer'] },

    /* ---------------------------------------------------------------- anomaly detection */
    { slug: 'iforest', name: 'Isolation forest', short: 'iForest', family: 'anomaly', tasks: ['anomaly'], lib: 'scikit-learn', pip: ['scikit-learn'],
      power: 3.8, interp: 2.8, speed: 4.6, minRows: 'xs', maxRows: 'xl', cat: false, miss: false, ivals: false, global: false, scale: false, tmpl: 'anom',
      summary: 'Random trees that split on random features at random thresholds. Anomalies are few and different, so they get isolated in very few splits: a short path means an odd row.',
      eq: T`s(\mathbf x, n) = 2^{-\mathbb E[h(\mathbf x)]/c(n)},\qquad c(n) = 2H(n-1) - \frac{2(n-1)}{n}`,
      eqNote: T`$h(\mathbf x)$ is the path length that isolates $\mathbf x$ in one tree, $c(n)$ the average path length for $n$ points, $H$ the harmonic number. Scores near 1 are anomalies; well below 0.5 is normal.`,
      obj: '', intuition: '"How many random questions does it take to single this row out?" A typical customer takes many. A card buying gold at 4 a.m. in another country takes two.',
      assumptions: ['Anomalies are rare and differ in at least a few features', 'Differences along the axes (rotated structure is harder)'],
      params: [['n_estimators', '100 – 500', 'More trees, steadier scores'], ['max_samples', '256 – 4096', 'Rows per tree: small is the point'], ['contamination', 'expected anomaly share', 'Only sets the flag threshold']],
      pros: ['Fast, near-linear time', 'No scaling, no distance metric', 'Fine in high dimensions'], cons: ['Scores are relative, not probabilities', 'Misses anomalies that only show along diagonals'],
      use: 'The default first detector for tabular data: transactions, logs, sensor snapshots.', complexity: [T`O(t\,\psi\log\psi)`, T`O(t\log\psi)`], related: ['lof', 'ocsvm', 'robustcov'] },
    { slug: 'lof', name: 'Local outlier factor', short: 'LOF', family: 'anomaly', tasks: ['anomaly'], lib: 'scikit-learn', pip: ['scikit-learn'],
      power: 3.4, interp: 3, speed: 2.8, minRows: 'xs', maxRows: 'l', cat: false, miss: false, ivals: false, global: false, scale: true, tmpl: 'anom',
      summary: 'Compares the density around each row with the density around its neighbours. A point in a sparse spot next to a dense cluster stands out, even when global distances look normal.',
      eq: T`\operatorname{LOF}_k(\mathbf x) = \frac{1}{|N_k(\mathbf x)|}\sum_{\mathbf o\in N_k(\mathbf x)}\frac{\operatorname{lrd}_k(\mathbf o)}{\operatorname{lrd}_k(\mathbf x)},\qquad \operatorname{lrd}_k(\mathbf x) = \Big(\tfrac{1}{|N_k(\mathbf x)|}\textstyle\sum_{\mathbf o\in N_k(\mathbf x)} \max\big(d_k(\mathbf o),\, d(\mathbf x,\mathbf o)\big)\Big)^{-1}`,
      eqNote: T`$d_k(\mathbf o)$ is the distance from $\mathbf o$ to its $k$-th neighbour. LOF ≈ 1: as dense as the neighbours. LOF ≫ 1: an outlier.`,
      obj: '', intuition: 'A house 2 km from the next is normal in the countryside and very odd in a city centre. LOF judges each point against its own neighbourhood.',
      assumptions: ['Meaningful distances: scaled features', 'Low to moderate dimensions'],
      params: [['n_neighbors', '10 – 50', 'Neighbourhood size'], ['metric', 'euclidean | manhattan', '']],
      pros: ['Finds local anomalies among clusters of different density', 'Explains by neighbours'], cons: ['Slow on big data', 'Curse of dimensionality', 'Sensitive to k'],
      use: 'Data with clusters of different density, where odd means odd for its neighbourhood.', complexity: [T`O(n\log n\,p)\ \text{to}\ O(n^2p)`, T`O(\log n\,p)`], related: ['knn', 'iforest'] },
    { slug: 'ocsvm', name: 'One-class SVM', short: 'OCSVM', family: 'anomaly', tasks: ['anomaly'], lib: 'scikit-learn', pip: ['scikit-learn'],
      power: 3.2, interp: 1.8, speed: 2, minRows: 'xs', maxRows: 'm', cat: false, miss: false, ivals: false, global: false, scale: true, tmpl: 'anom',
      summary: 'Learns a boundary around the normal data in a kernel feature space. Points outside it are anomalies.',
      eq: T`f(\mathbf x) = \operatorname{sign}\Big(\sum_i \alpha_i K(\mathbf x_i,\mathbf x) - \rho\Big)`, eqNote: T`$\nu$ is an upper bound on the share of training points left outside, and a lower bound on the share of support vectors.`,
      obj: T`\min_{\mathbf w,\boldsymbol\xi,\rho}\ \tfrac12\lVert\mathbf w\rVert^2 + \frac{1}{\nu n}\sum_i\xi_i - \rho\quad\text{s.t.}\quad \mathbf w^\top\phi(\mathbf x_i)\ge\rho-\xi_i,\ \xi_i\ge0`,
      intuition: 'Push the data away from the origin with the widest possible margin in feature space. Whatever lands on the origin\'s side looks unlike the training data.',
      assumptions: ['Training data you trust to be mostly normal', 'Scaled, mostly numeric features'],
      params: [['nu', '0.001 – 0.2', 'Expected outlier share'], ['gamma', '"scale" or 1e-4 – 1', 'RBF width']],
      pros: ['Smooth, flexible boundary', 'Good novelty detector on clean data'], cons: [T`$O(n^2)$ training or worse`, 'Sensitive to gamma and scaling', 'Many anomalies in training distort it'],
      use: 'Novelty detection on a few thousand clean, numeric rows.', complexity: [T`O(n^2p)\ \text{to}\ O(n^3)`, T`O(n_{sv}\,p)`], related: ['svm', 'iforest'] },
    { slug: 'robustcov', name: 'Robust covariance (MCD)', short: 'MCD', family: 'anomaly', tasks: ['anomaly'], lib: 'scikit-learn', pip: ['scikit-learn'],
      power: 2.6, interp: 4, speed: 4.2, minRows: 'xs', maxRows: 'xl', cat: false, miss: false, ivals: false, global: false, scale: true, tmpl: 'anom',
      summary: 'Fits an ellipse to the bulk of the data with the Minimum Covariance Determinant, so outliers can\'t stretch it, then scores every row by its Mahalanobis distance.',
      eq: T`d^2(\mathbf x) = (\mathbf x-\hat{\boldsymbol\mu})^\top\hat\Sigma^{-1}(\mathbf x-\hat{\boldsymbol\mu})\ \sim\ \chi^2_p\ \ \text{(if Gaussian)}`,
      eqNote: T`$\hat{\boldsymbol\mu}, \hat\Sigma$ come from the $h$ rows whose covariance has the smallest determinant, so the outliers can't hide themselves.`,
      obj: T`\hat H = \arg\min_{|H| = h}\ \det\hat\Sigma_H`,
      intuition: 'The statistician\'s detector: how many standard deviations away is this row, once correlations are taken into account? Robust fitting stops the outliers from moving the yardstick.',
      assumptions: ['One roughly elliptical (Gaussian-like) cloud of normal data', 'More rows than features'],
      params: [['support_fraction', '0.5 – 1', 'Share of rows in the robust fit'], ['contamination', 'expected share', 'Flag threshold']],
      pros: ['Fast and well understood', 'A χ² reference for distances', 'Easy to say which features deviate'], cons: ['Assumes one elliptical cluster', 'Poor with many one-hot categories'],
      use: 'Mostly numeric, single-mode data: sensor readings, measurements, financial ratios.', complexity: [T`O(np^2 + p^3)`, T`O(p^2)`], related: ['iforest', 'ocsvm'] },
    { slug: 'stl', name: 'STL residual detector', short: 'STL', family: 'anomaly', tasks: ['anomaly'], lib: 'statsmodels', pip: ['statsmodels'],
      power: 3.4, interp: 4.7, speed: 4.3, minRows: 'xs', maxRows: 'l', cat: false, miss: false, ivals: false, global: false, scale: false, tmpl: 'anomts',
      summary: 'Seasonal-trend decomposition (LOESS) splits a metric into trend, season and remainder. Points with an extreme remainder, judged with a robust z-score, are flagged.',
      eq: T`y_t = T_t + S_t + R_t,\qquad z_t = \frac{R_t - \operatorname{median}(R)}{1.4826\,\operatorname{MAD}(R)},\qquad \text{flag} \iff |z_t| > z^*`,
      eqNote: T`$1.4826\cdot\operatorname{MAD}$ estimates the standard deviation of Gaussian noise while ignoring the outliers themselves. $z^* = 3.5$ is a common cut-off.`,
      obj: '', intuition: 'Low traffic on a Monday is not news if every Monday is low: that is seasonality. Remove the expected shape first, then look for surprises in what is left.',
      assumptions: ['A regular seasonal period', 'At least two seasons of history', 'y is the metric you watch, t its time column'],
      params: [['period', 'season length', '24, 7, 52, 12'], ['robust', 'True', 'LOESS that down-weights outliers'], ['z*', '3 – 5', 'Flag threshold']],
      pros: ['Every flag explains itself: value vs. expected', 'No labels needed', 'Fast'], cons: ['One series at a time', 'One seasonal period', 'A level shift shows as a run of flags'],
      use: 'Monitoring a metric over time: traffic, sales, load, latency, sensor readings.', complexity: [T`O(n)`, T`O(n)`], related: ['ets', 'iforest'] },

    /* ---------------------------------------------------------------- clustering */
    { slug: 'kmeans', name: 'k-means', short: 'kMeans', family: 'cluster', tasks: ['cluster'], lib: 'scikit-learn', pip: ['scikit-learn'],
      power: 3, interp: 4.2, speed: 4.8, minRows: 'xs', maxRows: 'xl', cat: false, miss: false, ivals: false, global: false, scale: true, tmpl: 'clus',
      summary: 'Places k centroids, assigns each row to the nearest one, and moves each centroid to the mean of its rows until nothing changes.',
      eq: T`c(\mathbf x) = \arg\min_k\ \lVert\mathbf x - \boldsymbol\mu_k\rVert^2`, eqNote: 'Lloyd\'s algorithm alternates assignment and update. k-means++ seeding picks well-spread starting centroids.',
      obj: T`\min_{\{C_k\},\{\boldsymbol\mu_k\}}\ \sum_{k=1}^{K}\sum_{\mathbf x_i\in C_k}\lVert\mathbf x_i - \boldsymbol\mu_k\rVert^2`,
      intuition: 'Each cluster is summed up by one prototype row, "the average budget shopper". Easy to name, easy to explain.',
      assumptions: ['Roughly round clusters of similar size', 'Scaled features', 'You choose k (here: by silhouette)'],
      params: [['n_clusters', '2 – 12', 'Chosen by silhouette'], ['n_init', '"auto" or 10', 'Restarts against bad local optima']],
      pros: ['Fast on millions of rows', 'Centroids are readable profiles', 'New rows assigned instantly'], cons: ['Needs k', 'Prefers round clusters', 'Sensitive to outliers and scaling'],
      use: 'Customer or product segmentation into a handful of nameable groups.', complexity: [T`O(nKp\cdot\text{iters})`, T`O(Kp)`], related: ['gmm', 'agglo'] },
    { slug: 'gmm', name: 'Gaussian mixture', short: 'GMM', family: 'cluster', tasks: ['cluster'], lib: 'scikit-learn', pip: ['scikit-learn'],
      power: 3.3, interp: 3.6, speed: 3.8, minRows: 'xs', maxRows: 'l', cat: false, miss: false, ivals: false, global: false, scale: true, tmpl: 'clus',
      summary: 'A soft k-means: the data is a mix of K Gaussians fitted by expectation–maximisation, and every row gets a probability for every cluster.',
      eq: T`p(\mathbf x) = \sum_{k=1}^{K}\pi_k\,\mathcal N(\mathbf x\mid\boldsymbol\mu_k,\Sigma_k),\qquad r_{ik} = \frac{\pi_k\,\mathcal N(\mathbf x_i\mid\boldsymbol\mu_k,\Sigma_k)}{\sum_j\pi_j\,\mathcal N(\mathbf x_i\mid\boldsymbol\mu_j,\Sigma_j)}`,
      eqNote: T`$r_{ik}$ is cluster $k$'s responsibility for row $i$. K is chosen by BIC.`,
      obj: T`\max_{\pi,\mu,\Sigma}\ \sum_i\log\sum_k\pi_k\,\mathcal N(\mathbf x_i\mid\boldsymbol\mu_k,\Sigma_k),\qquad \text{BIC} = -2\log\hat L + d\log n`,
      intuition: 'Clusters can be stretched and tilted, and a row between two of them says so (60/40) instead of being forced into one.',
      assumptions: ['Clusters roughly Gaussian', 'Scaled features'],
      params: [['n_components', '2 – 12', 'By BIC'], ['covariance_type', 'full | diag | tied | spherical', 'Shape freedom']],
      pros: ['Soft memberships', 'Elliptical clusters', 'A likelihood for choosing K'], cons: ['Local optima', 'Many parameters with full covariances', 'Gaussian assumption'],
      use: 'Overlapping segments, or when you need a membership probability.', complexity: [T`O(nKp^2\cdot\text{iters})`, T`O(Kp^2)`], related: ['kmeans', 'hdbscan'] },
    { slug: 'hdbscan', name: 'HDBSCAN', short: 'HDBSCAN', family: 'cluster', tasks: ['cluster'], lib: 'scikit-learn', pip: ['scikit-learn'],
      power: 3.6, interp: 3, speed: 3.2, minRows: 'xs', maxRows: 'l', cat: false, miss: false, ivals: false, global: false, scale: true, tmpl: 'clus',
      summary: 'Density-based clustering: finds clusters of any shape and different densities, decides how many there are, and labels sparse points as noise.',
      eq: T`d_{\text{mreach}}(\mathbf a,\mathbf b) = \max\big(\operatorname{core}_k(\mathbf a),\ \operatorname{core}_k(\mathbf b),\ d(\mathbf a,\mathbf b)\big)`,
      eqNote: T`$\operatorname{core}_k$ is the distance to the $k$-th nearest neighbour. HDBSCAN builds a minimum spanning tree on this distance, condenses the hierarchy, and keeps the most stable clusters.`,
      obj: T`\max_{\{C\}}\ \sum_C\sum_{\mathbf x\in C}\big(\lambda_{\mathbf x} - \lambda_{\text{birth}}(C)\big),\qquad \lambda = 1/d`,
      intuition: 'Clusters are islands of high density in a sea of low density. Lower the sea level slowly and keep the islands that last longest.',
      assumptions: ['Clusters are denser than the space between them', 'Scaled features, moderate dimensions'],
      params: [['min_cluster_size', '5 – 500', 'Smallest group worth calling a cluster'], ['min_samples', '1 – 50', 'Higher = more conservative, more noise']],
      pros: ['No k to choose', 'Any shape, varying density', 'A noise label for outliers'], cons: ['Struggles in high dimensions', 'No native predict: new rows go to their nearest neighbours here'],
      use: 'Exploring segments when you don\'t know how many there are, or data with lots of noise.', complexity: [T`O(n\log n\,p)\ \text{to}\ O(n^2)`, T`O(\log n\,p)`], related: ['kmeans', 'lof'] },
    { slug: 'agglo', name: 'Hierarchical clustering (Ward)', short: 'Ward', family: 'cluster', tasks: ['cluster'], lib: 'scikit-learn', pip: ['scikit-learn'],
      power: 3.1, interp: 4.3, speed: 2.6, minRows: 'xs', maxRows: 'm', cat: false, miss: false, ivals: false, global: false, scale: true, tmpl: 'clus',
      summary: 'Starts with every row as its own cluster and keeps merging the pair whose merge adds the least within-cluster variance. The result is a tree you can cut at any number of clusters.',
      eq: T`\Delta(A,B) = \frac{|A|\,|B|}{|A|+|B|}\,\lVert\boldsymbol\mu_A - \boldsymbol\mu_B\rVert^2`, eqNote: 'Ward\'s criterion is the increase of the k-means objective caused by the merge. Other linkages use the minimum, maximum or average distance.',
      obj: '', intuition: 'A family tree of your rows. Cut it high for a few broad groups, low for many fine ones; the dendrogram shows how solid each split is.',
      assumptions: ['Scaled features', T`Up to a few tens of thousands of rows ($O(n^2)$ memory)`],
      params: [['n_clusters', '2 – 12', 'Where to cut the tree'], ['linkage', 'ward | average | complete', 'Merge rule']],
      pros: ['A whole hierarchy, not one partition', 'Deterministic', 'Readable dendrogram'], cons: [T`$O(n^2)$ memory: sample big data`, 'Merges are never undone'],
      use: 'When the hierarchy itself is interesting (product families, taxonomies) and the data fits in memory.', complexity: [T`O(n^2\log n)`, T`O(Kp)`], related: ['kmeans', 'gmm'] }
  ];
  RI.MODEL = {};
  RI.MODELS.forEach(function (m, i) { m.idx = i; RI.MODEL[m.slug] = m; });

  /* ---------------------------------------------------------------- feature development cookbook */
  RI.FEATURES = [
    { slug: 'lags', name: 'Lag features', tags: ['time series'], eq: T`x^{\text{lag}_k}_t = y_{t-k}`,
      text: 'The target\'s own past is usually the strongest predictor. Pick lags at 1, 2, 3 and at the season (7, 14, 28 for daily data; 24 and 168 for hourly).',
      warn: 'When forecasting h steps ahead, a lag k < h needs predicted values (recursive forecasting), or use only lags ≥ h (direct strategy).',
      code: T`for k in [1, 7, 14, 28]:
    df[f"lag_{k}"] = df.groupby("store")["sales"].shift(k)` },
    { slug: 'rolling', name: 'Rolling-window statistics', tags: ['time series'], eq: T`\bar y^{(w)}_t = \frac1w\sum_{i=1}^{w} y_{t-i}`,
      text: 'Smoothed recent level and volatility: rolling mean, std, min, max over windows that match your seasons.',
      warn: 'Shift by one before rolling, or today\'s target leaks into today\'s feature.',
      code: T`g = df.groupby("store")["sales"]
df["roll_mean_7"] = g.transform(lambda s: s.shift(1).rolling(7, min_periods=1).mean())
df["roll_std_28"] = g.transform(lambda s: s.shift(1).rolling(28, min_periods=2).std())` },
    { slug: 'ewm', name: 'Exponentially weighted means', tags: ['time series'], eq: T`m_t = \lambda y_{t-1} + (1-\lambda)\,m_{t-1}`,
      text: 'A rolling mean with geometric weights: recent values count more. One parameter (the half-life) instead of a hard window.',
      warn: 'Shift by one first, as with rolling windows.',
      code: T`df["ewm_7"] = df.groupby("store")["sales"].transform(lambda s: s.shift(1).ewm(halflife=7).mean())` },
    { slug: 'calendar', name: 'Calendar parts', tags: ['time series', 'tabular'], eq: T`t \mapsto (\text{dow}, \text{month}, \text{doy}, \text{hour}, \dots)`,
      text: 'Day of week, month, hour, week of year, is-weekend, days to month end. Trees can use them raw; linear models need one-hot or cyclic encodings.',
      warn: '', code: T`t = df["date"]
df["dow"] = t.dt.dayofweek
df["month"] = t.dt.month
df["is_weekend"] = (t.dt.dayofweek >= 5).astype(int)` },
    { slug: 'cyclic', name: 'Cyclical (sin/cos) encoding', tags: ['time series', 'tabular'], eq: T`\big(\sin\tfrac{2\pi x}{P},\ \cos\tfrac{2\pi x}{P}\big)`,
      text: 'Puts hour 23 next to hour 0 and December next to January. You need both sin and cos to identify the position on the circle.',
      warn: '', code: T`df["hour_sin"] = np.sin(2 * np.pi * df["hour"] / 24)
df["hour_cos"] = np.cos(2 * np.pi * df["hour"] / 24)` },
    { slug: 'fourier', name: 'Fourier terms', tags: ['time series'], eq: T`\sum_{k=1}^{K}\Big[a_k\sin\tfrac{2\pi k t}{P} + b_k\cos\tfrac{2\pi k t}{P}\Big]`,
      text: 'A smooth seasonal shape from a few sine/cosine pairs. Handles long or non-integer periods (365.25 days) that dummies can\'t.',
      warn: 'K controls wiggliness. Pick it by AIC or cross-validation.',
      code: T`t = (df["date"] - df["date"].min()).dt.days
for k in range(1, 4):
    df[f"sin_y{k}"] = np.sin(2 * np.pi * k * t / 365.25)
    df[f"cos_y{k}"] = np.cos(2 * np.pi * k * t / 365.25)` },
    { slug: 'events', name: 'Holiday and event flags', tags: ['time series'], eq: T`h_t = \mathbb 1[t \in \mathcal H],\quad d_t = \min_{e\in\mathcal H}|t - e|`,
      text: 'Binary flags for holidays, promotions and launches, plus "days until" and "days since" the nearest one. Often the biggest single gain for retail.',
      warn: 'Only use events you will also know about in the future.',
      code: T`import holidays
hol = holidays.country_holidays("FR")
df["is_holiday"] = df["date"].dt.date.map(lambda d: d in hol).astype(int)` },
    { slug: 'known', name: 'Known-ahead vs. past-only drivers', tags: ['time series'], eq: T`\hat y_{t+h} = f\big(y_{\le t},\ \mathbf x^{\text{past}}_{\le t},\ \mathbf x^{\text{known}}_{\le t+h}\big)`,
      text: 'Prices, promos, holidays and weather forecasts are known for the future and can be used as-is. Footfall or competitor sales are not: use them only through lags of at least h.',
      warn: 'This is the most common leakage in forecasting projects: a model that looks brilliant in testing and fails in production.',
      code: T`KNOWN = ["promo", "price", "is_holiday"]   # used at time t
PAST = ["footfall"]                          # used only as lag >= horizon
for c in PAST:
    df[f"{c}_lag{H}"] = df.groupby("store")[c].shift(H)` },
    { slug: 'diff', name: 'Differencing', tags: ['time series'], eq: T`\nabla y_t = y_t - y_{t-1},\qquad \nabla_m y_t = y_t - y_{t-m}`,
      text: 'Removes trend (first difference) or seasonality (seasonal difference) so the series becomes stationary. Model the change, then add it back.',
      warn: 'Invert the transform on predictions before scoring them.', code: T`df["d1"] = df.groupby("store")["sales"].diff(1)` },
    { slug: 'log', name: 'Log and Box–Cox transforms', tags: ['tabular', 'time series'], eq: T`y^{(\lambda)} = \begin{cases}\frac{y^\lambda - 1}{\lambda} & \lambda\neq 0\\ \log y & \lambda = 0\end{cases}`,
      text: 'Stabilise variance and turn multiplicative effects into additive ones. Use log1p for counts with zeros.',
      warn: 'expm1 of a mean in log space is a median, not a mean. Correct it if you need unbiased totals.',
      code: T`y = np.log1p(df["sales"])
# ... fit on y, then
pred = np.expm1(model.predict(X))` },
    { slug: 'scaling', name: 'Standardisation and robust scaling', tags: ['tabular'], eq: T`z = \frac{x - \mu}{\sigma}\quad\text{or}\quad z = \frac{x - \operatorname{median}}{\operatorname{IQR}}`,
      text: 'Needed by distance- and gradient-based models (kNN, SVM, linear models with penalties, neural nets). Trees don\'t care.',
      warn: 'Fit the scaler on training data only, inside the pipeline.', code: T`from sklearn.preprocessing import StandardScaler, RobustScaler
pre = StandardScaler()   # inside a Pipeline, so CV folds stay clean` },
    { slug: 'onehot', name: 'One-hot encoding', tags: ['tabular'], eq: T`x = c_k \;\mapsto\; \mathbf e_k \in \{0,1\}^K`,
      text: 'One binary column per category. Exact and simple. Group rare categories so the width stays manageable.',
      warn: 'Unknown categories at prediction time need handle_unknown="ignore".',
      code: T`OneHotEncoder(handle_unknown="ignore", min_frequency=10)` },
    { slug: 'target-enc', name: 'Target (mean) encoding', tags: ['tabular'], eq: T`\tilde x_c = \frac{n_c\,\bar y_c + a\,\bar y}{n_c + a}`,
      text: 'Replace a high-cardinality category with a smoothed mean of the target for that category. A strong signal for ids such as product or postcode.',
      warn: 'Compute it out-of-fold (cross-fitting), or the encoding memorises the target. CatBoost does this for you.',
      code: T`from sklearn.preprocessing import TargetEncoder   # sklearn >= 1.3, cross-fitted
enc = TargetEncoder(smooth="auto")` },
    { slug: 'freq-enc', name: 'Frequency encoding', tags: ['tabular'], eq: T`\tilde x_c = \frac{n_c}{n}`,
      text: 'How common a category is often carries signal in itself (popular products, big cities), with no target leakage.',
      warn: '', code: T`df["city_freq"] = df["city"].map(df["city"].value_counts(normalize=True))` },
    { slug: 'missing', name: 'Missing-value indicators', tags: ['tabular'], eq: T`m_j = \mathbb 1[x_j = \text{NA}]`,
      text: 'Whether a value is missing is often informative in its own right. Impute, and add a flag so the model can tell.',
      warn: '', code: T`SimpleImputer(strategy="median", add_indicator=True)` },
    { slug: 'interactions', name: 'Interactions and polynomials', tags: ['tabular'], eq: T`x_i x_j,\quad x_i^2`,
      text: 'Let linear models express "the effect of size depends on city". Trees find interactions on their own; linear models need them spelled out.',
      warn: 'The number of terms grows as p². Restrict to your key drivers.',
      code: T`df["sqm_x_rooms"] = df["sqm"] * df["rooms"]
df["sqm_sq"] = df["sqm"] ** 2` },
    { slug: 'group-agg', name: 'Group aggregates', tags: ['tabular', 'time series'], eq: T`\bar x_{g(i)} = \frac{1}{|g|}\sum_{j\in g} x_j`,
      text: 'Compare each row to its group: price relative to the category mean, sales relative to the store mean.',
      warn: 'Compute group statistics on the training data only, then map them onto new rows.',
      code: T`means = train.groupby("city")["sqm"].mean()
df["sqm_vs_city"] = df["sqm"] / df["city"].map(means)` },
    { slug: 'tfidf', name: 'TF–IDF text features', tags: ['tabular'], eq: T`\operatorname{tfidf}(w, d) = \operatorname{tf}(w,d)\cdot\log\frac{N}{1+\operatorname{df}(w)}`,
      text: 'Turns free text into sparse word weights. Simple, fast and strong next to tabular features. Use embeddings when meaning matters more than keywords.',
      warn: '', code: T`TfidfVectorizer(max_features=5000, ngram_range=(1, 2), min_df=2)` }
  ];

  /* ---------------------------------------------------------------- validation schemes; folds: rows of 't'rain/'v'alid/'.'unused/'g'ap */
  RI.VALIDATION = [
    { slug: 'holdout', name: 'Holdout split', tags: ['tabular'], eq: T`\mathcal D = \mathcal D_{\text{train}} \sqcup \mathcal D_{\text{test}}`,
      text: 'One random split, e.g. 80/20. Quick, but noisy on small data.', warn: 'Never use a random split on time-ordered data.',
      folds: ['ttttttttvv'], code: T`X_tr, X_te, y_tr, y_te = train_test_split(X, y, test_size=0.2, random_state=42)` },
    { slug: 'kfold', name: 'k-fold cross-validation', tags: ['tabular'], eq: T`\widehat{\text{Err}}_{\text{CV}} = \frac1k\sum_{j=1}^{k}\frac{1}{|F_j|}\sum_{i\in F_j}\ell\big(y_i, \hat f^{-j}(\mathbf x_i)\big)`,
      text: 'Every row is validated exactly once. The mean is the estimate and the spread across folds is its uncertainty.', warn: 'Assumes rows are independent (i.i.d.).',
      folds: ['vvtttttttt', 'ttvvtttttt', 'ttttvvtttt', 'ttttttvvtt', 'ttttttttvv'], code: T`cross_val_score(model, X, y, cv=KFold(5, shuffle=True, random_state=42))` },
    { slug: 'stratified', name: 'Stratified k-fold', tags: ['tabular', 'classification'], eq: T`P_{F_j}(y=k) \approx P_{\mathcal D}(y=k)\ \ \forall j,k`,
      text: 'k-fold that keeps the class proportions in every fold. Essential for rare positives.', warn: '',
      folds: ['vvtttttttt', 'ttvvtttttt', 'ttttvvtttt', 'ttttttvvtt', 'ttttttttvv'], code: T`StratifiedKFold(5, shuffle=True, random_state=42)` },
    { slug: 'group', name: 'Group k-fold', tags: ['tabular'], eq: T`g(i) \in G_{\text{train}} \Rightarrow g(i) \notin G_{\text{valid}}`,
      text: 'All rows of a customer, patient or store stay on the same side. It measures how well you generalise to new groups.', warn: 'If the same group appears in train and validation, scores are inflated.',
      folds: ['vvvttttttt', 'tttvvvtttt', 'ttttttvvvt'], code: T`GroupKFold(5).split(X, y, groups=df["customer_id"])` },
    { slug: 'expanding', name: 'Time-series split (expanding window)', tags: ['time series'], eq: T`\text{train} = [1, t_j],\ \ \text{valid} = (t_j, t_j + h]`,
      text: 'Train on everything up to a cutoff and validate on the next block, then move the cutoff forward. The past never sees the future.', warn: '',
      folds: ['tttvv.....', 'tttttvv...', 'tttttttvv.', 'ttttttttvv'], code: T`TimeSeriesSplit(n_splits=4, test_size=h)` },
    { slug: 'rolling-origin', name: 'Rolling origin (sliding window)', tags: ['time series'], eq: T`\text{train} = (t_j - w, t_j],\ \ \text{valid} = (t_j, t_j + h]`,
      text: 'Like the expanding window, but the training window has a fixed length, so old regimes drop out. Good when the process drifts.', warn: '',
      folds: ['tttvv.....', '..tttvv...', '....tttvv.', '.....tttvv'], code: T`TimeSeriesSplit(n_splits=4, max_train_size=w, test_size=h)` },
    { slug: 'purged', name: 'Purged split with embargo', tags: ['time series', 'finance'], eq: T`\text{train} \cap [t_j - g,\ t_j + h + g] = \varnothing`,
      text: 'Leaves a gap between train and validation so overlapping labels (e.g. 30-day returns) or slow features can\'t leak across the boundary.', warn: '',
      folds: ['ttgvv.....', 'ttttgvv...', 'ttttttgvv.'], code: T`TimeSeriesSplit(n_splits=3, test_size=h, gap=g)` },
    { slug: 'tuning', name: 'Cross-validated tuning (Optuna)', tags: ['tabular', 'time series'], eq: T`\boldsymbol\lambda^* = \arg\min_{\boldsymbol\lambda}\ \frac1k\sum_{j=1}^{k}\mathcal L\big(\hat f_{\boldsymbol\lambda}^{-j},\,F_j\big),\qquad \text{TPE: next } \boldsymbol\lambda \propto \frac{\ell(\boldsymbol\lambda)}{g(\boldsymbol\lambda)}`,
      text: 'Each trial picks hyperparameters, scores them by cross-validation on the training rows, and reports back. Optuna\'s TPE sampler models good trials ($\ell$) and bad ones ($g$) separately and proposes values where good is likely. Tick "tune" in the Lab and the listing gets this search.', warn: 'Tune on the training rows only. The holdout (or the outer loop of nested CV) must never be seen by the search, or the reported score is optimistic.',
      folds: ['vvtttttt..', 'ttvvtttt..', 'ttttvvtt..', 'ttttttvv..'], code: T`study = optuna.create_study(direction="maximize")
study.optimize(lambda trial: cross_val_score(make_model(trial), X, y, cv=5).mean(), n_trials=40)` },
    { slug: 'nested', name: 'Nested cross-validation', tags: ['tabular'], eq: T`\text{outer: estimate} \;\big|\; \text{inner: tune}`,
      text: 'An inner loop tunes hyperparameters and an outer loop scores the whole tuning procedure. Unbiased, and expensive.', warn: 'Reporting the inner-loop score as your result is optimistic.',
      folds: ['vvtttttttt', 'ttvvtttttt', 'ttttvvtttt'], code: T`outer = cross_val_score(GridSearchCV(model, grid, cv=3), X, y, cv=5)` }
  ];

  /* ---------------------------------------------------------------- metrics */
  RI.METRICS = [
    { slug: 'mae', name: 'MAE', long: 'Mean absolute error', kind: 'regression', eq: T`\text{MAE} = \frac1n\sum_i |y_i - \hat y_i|`, text: 'Average miss in the target\'s units. Robust to outliers. Minimised by the median.', code: T`mean_absolute_error(y, p)` },
    { slug: 'rmse', name: 'RMSE', long: 'Root mean squared error', kind: 'regression', eq: T`\text{RMSE} = \sqrt{\frac1n\sum_i (y_i - \hat y_i)^2}`, text: 'Penalises big misses heavily. Minimised by the mean.', code: T`np.sqrt(mean_squared_error(y, p))` },
    { slug: 'r2', name: 'R²', long: 'Coefficient of determination', kind: 'regression', eq: T`R^2 = 1 - \frac{\sum_i (y_i-\hat y_i)^2}{\sum_i (y_i-\bar y)^2}`, text: 'Share of variance explained relative to predicting the mean. Can go negative on test data.', code: T`r2_score(y, p)` },
    { slug: 'mape', name: 'MAPE', long: 'Mean absolute percentage error', kind: 'forecast', eq: T`\text{MAPE} = \frac{100}{n}\sum_i \Big|\frac{y_i-\hat y_i}{y_i}\Big|`, text: 'Scale-free and easy to explain. Undefined at zero, and it punishes over-forecasts more than under-forecasts.', code: T`mean_absolute_percentage_error(y, p)` },
    { slug: 'smape', name: 'sMAPE', long: 'Symmetric MAPE', kind: 'forecast', eq: T`\text{sMAPE} = \frac{200}{n}\sum_i \frac{|y_i-\hat y_i|}{|y_i|+|\hat y_i|}`, text: 'A bounded (0–200%) cousin of MAPE, used in the M competitions.', code: T`200 * np.mean(np.abs(y - p) / (np.abs(y) + np.abs(p)))` },
    { slug: 'mase', name: 'MASE', long: 'Mean absolute scaled error', kind: 'forecast', eq: T`\text{MASE} = \frac{\frac1h\sum_{k=1}^{h}|y_{T+k}-\hat y_{T+k}|}{\frac{1}{T-m}\sum_{t=m+1}^{T}|y_t - y_{t-m}|}`, text: 'Your MAE divided by the in-sample seasonal naïve MAE. Below 1 means you beat the naïve baseline. Comparable across series.', code: T`mae / np.mean(np.abs(y_train[m:] - y_train[:-m]))` },
    { slug: 'pinball', name: 'Pinball loss', long: 'Quantile loss', kind: 'forecast', eq: T`L_\tau(y,\hat q) = \max\big(\tau(y-\hat q),\ (\tau-1)(y-\hat q)\big)`, text: 'Scores a quantile forecast. Averaged over many τ it approximates the CRPS.', code: T`mean_pinball_loss(y, q, alpha=0.9)` },
    { slug: 'coverage', name: 'Interval coverage', long: 'Empirical coverage', kind: 'forecast', eq: T`\hat c = \frac1n\sum_i \mathbb 1\big[\,l_i \le y_i \le u_i\,\big]`, text: 'A 90% interval should contain about 90% of the actuals. Report it with the average width: narrow and well calibrated is the goal.', code: T`np.mean((y >= lo) & (y <= hi))` },
    { slug: 'precision-k', name: 'Precision@k', long: 'Precision at k', kind: 'anomaly', eq: T`P@k = \frac{\big|\{\text{top-}k \text{ scores}\}\cap\{\text{true anomalies}\}\big|}{k}`, text: 'Of the k rows the detector ranks as most anomalous, how many really are? Set k to what your team can review in a day. Needs a few labelled anomalies.', code: T`top = np.argsort(-score)[:k]; precision_at_k = y[top].mean()` },
    { slug: 'silhouette', name: 'Silhouette', long: 'Silhouette coefficient', kind: 'clustering', eq: T`s(i) = \frac{b(i) - a(i)}{\max\{a(i),\, b(i)\}}`, text: '$a(i)$ is the mean distance from row $i$ to its own cluster, $b(i)$ to the nearest other cluster. Near 1: tight, well separated; near 0: on a border; negative: probably in the wrong cluster.', code: T`silhouette_score(X, labels)` },
    { slug: 'davies-bouldin', name: 'Davies–Bouldin', long: 'Davies–Bouldin index', kind: 'clustering', eq: T`\text{DB} = \frac1K\sum_{k=1}^{K}\max_{j\ne k}\frac{\sigma_k + \sigma_j}{\lVert\boldsymbol\mu_k - \boldsymbol\mu_j\rVert}`, text: 'Average worst-case ratio of cluster spread to centroid distance. Lower is better; 0 is perfect.', code: T`davies_bouldin_score(X, labels)` },
    { slug: 'accuracy', name: 'Accuracy', long: 'Accuracy & balanced accuracy', kind: 'classification', eq: T`\text{BA} = \frac1K\sum_k \frac{TP_k}{TP_k + FN_k}`, text: 'Plain accuracy misleads with imbalanced classes (99% by always saying "no"). Balanced accuracy averages recall per class.', code: T`balanced_accuracy_score(y, p)` },
    { slug: 'f1', name: 'F1', long: 'Precision, recall, F1', kind: 'classification', eq: T`F_1 = \frac{2PR}{P+R},\quad P = \frac{TP}{TP+FP},\ R = \frac{TP}{TP+FN}`, text: 'Precision: how many flagged cases are real. Recall: how many real cases get flagged. F1 is their harmonic mean.', code: T`f1_score(y, p, average="macro")` },
    { slug: 'auc', name: 'ROC AUC', long: 'Area under the ROC curve', kind: 'classification', eq: T`\text{AUC} = P\big(s(\mathbf x^+) > s(\mathbf x^-)\big)`, text: 'The probability that a random positive is scored above a random negative. Threshold-free; 0.5 = coin flip.', code: T`roc_auc_score(y, proba)` },
    { slug: 'prauc', name: 'PR AUC', long: 'Average precision', kind: 'classification', eq: T`\text{AP} = \sum_n (R_n - R_{n-1})\,P_n`, text: 'Better than ROC AUC when positives are rare: it focuses on the positive class.', code: T`average_precision_score(y, proba)` },
    { slug: 'logloss', name: 'Log loss', long: 'Cross-entropy', kind: 'classification', eq: T`\mathcal L = -\frac1n\sum_i\sum_k y_{ik}\log \hat p_{ik}`, text: 'Scores the probabilities themselves, and punishes confident mistakes hard. A proper scoring rule.', code: T`log_loss(y, proba)` },
    { slug: 'brier', name: 'Brier score', long: 'Brier score', kind: 'classification', eq: T`\text{BS} = \frac1n\sum_i (\hat p_i - y_i)^2`, text: 'Mean squared error of probabilities. Splits into calibration and refinement.', code: T`brier_score_loss(y, proba)` }
  ];
})();

/* ===== _engine.html ===== */
(function () {
  'use strict';
  var RI = window.RI = window.RI || {};
  var esc = UI.esc;

  /* ------------------------------------------------------------------ icons this app adds */
  var IC = UI.ICONS;
  IC.flask = '<path d="M9 3h6M10 3v6L4.5 18.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3"/><path d="M7.5 14h9"/>';
  IC.book = '<path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H20v15H5.5A1.5 1.5 0 0 0 4 19.5z"/><path d="M4 19.5A1.5 1.5 0 0 0 5.5 21H20v-3"/><path d="M8 7h8M8 10.5h6"/>';
  IC.notebook = '<rect x="5" y="3" width="15" height="18" rx="1.5"/><path d="M5 7H3M5 12H3M5 17H3M9 7.5h7M9 11h7M9 14.5h4"/>';
  IC.sigma = '<path d="M18 5H6l6 7-6 7h12"/>';
  IC.code = '<path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14"/>';
  IC.download = '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 19h16"/>';
  IC.fork = '<circle cx="6" cy="5" r="2"/><circle cx="18" cy="5" r="2"/><circle cx="12" cy="19" r="2"/><path d="M6 7v2a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V7M12 12v5"/>';
  IC.save = '<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v5h7V3M8 21v-7h8v7"/>';
  IC.share = '<circle cx="6" cy="12" r="2.2"/><circle cx="18" cy="6" r="2.2"/><circle cx="18" cy="18" r="2.2"/><path d="m8 11 8-4M8 13l8 4"/>';
  IC.target = '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".8"/>';
  IC.table = '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M3 9h18M3 14h18M9 4v16"/>';
  IC.plane = '<path d="M4 20V4M4 20h16"/><circle cx="9" cy="14" r="1.4"/><circle cx="13" cy="9" r="1.4"/><circle cx="17" cy="12" r="1.4"/>';

  /* ------------------------------------------------------------------ math */
  RI.tex = function (tex, display) {
    if (!tex) return '';
    if (window.katex) {
      try { return window.katex.renderToString(tex, { displayMode: !!display, throwOnError: false, strict: 'ignore' }); } catch (e) { /* fall through */ }
    }
    return '<code>' + esc(tex) + '</code>';
  };
  /* Prose with inline $...$ math. */
  RI.mtext = function (s) {
    return String(s || '').split('$').map(function (part, i) { return i % 2 ? RI.tex(part, false) : esc(part); }).join('');
  };
  /* Pages that show maths redraw once KaTeX arrives (it loads with `defer`). */
  RI.whenTex = function (fn) {
    if (window.katex) return;
    var tries = 0, t = setInterval(function () {
      if (window.katex || ++tries > 40) { clearInterval(t); if (window.katex) fn(); }
    }, 150);
  };

  /* ------------------------------------------------------------------ parsing the pasted header */
  RI.TYPES = { numeric: 'numeric', categorical: 'categorical', datetime: 'datetime', boolean: 'boolean', text: 'text', id: 'id' };
  RI.TYPE_SYM = { numeric: 'ℝ', categorical: '𝒞', datetime: '𝒯', boolean: '𝔹', text: 'Σ*', id: '#' };
  RI.ROLES = [['feature', 'x', 'Feature'], ['target', 'y', 'Target'], ['time', 't', 'Time index'], ['group', 'g', 'Series / group id'], ['ignore', '∅', 'Ignore']];

  function splitLine(line, d) {
    var out = [], cur = '', q = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (ch === d && !q) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out.map(function (s) { return s.trim(); });
  }
  function delimiter(line) {
    var best = ',', n = 0;
    ['\t', ',', ';', '|'].forEach(function (d) { var k = splitLine(line, d).length; if (k > n) { n = k; best = d; } });
    if (n <= 1 && /\s{2,}|\s/.test(line.trim())) return 'ws';
    return best;
  }
  var RX = {
    time: /(^|_)(date|time|timestamp|ts|datetime|day|week|month|period|year_month|ds|dt)($|_)|_at$|_on$/i,
    id: /(^|_)(id|uuid|guid|key|code|sku|ean|isbn)$|^id_|_id$|^index$/i,
    bool: /^(is|has|was|can|did|should|flag)_|_(flag|yn)$|^(churn(ed)?|default(ed)?|fraud|converted|clicked|bought|active|holiday|promo|weekend|label)$/i,
    text: /(description|comment|review|text|body|notes?|summary|title|message|content|tweet|bio)$/i,
    cat: /(type|category|class|segment|region|country|city|state|province|store|shop|brand|channel|gender|plan|tier|color|colour|status|department|group|kind|zone|source|product|model|sector|industry|currency|weekday|band|grade|level)($|_)/i,
    target: /^(y|target|label|outcome|response|sales|demand|revenue|price|amount|units|quantity|qty|load|churn(ed)?|default(ed)?|converted|fraud|rent|score|value|count|sessions|visits|clicks|orders)($|_)|(_sold|_count|_total|_target|_mw|_eur|_usd)$/i,
    group: /(^|_)(store|shop|sku|item|product|series|site|station|sensor|meter|customer|account|region|country|city|location|warehouse|branch)(_id)?$/i
  };
  function guessFromName(name) {
    if (RX.time.test(name)) return 'datetime';
    if (RX.id.test(name)) return 'id';
    if (RX.bool.test(name)) return 'boolean';
    if (RX.text.test(name)) return 'text';
    if (RX.cat.test(name)) return 'categorical';
    return 'numeric';
  }
  function guessFromValues(name, vals) {
    vals = vals.filter(function (v) { return v !== '' && !/^(na|nan|null|none|-)$/i.test(v); });
    if (!vals.length) return guessFromName(name);
    var all = function (rx) { return vals.every(function (v) { return rx.test(v); }); };
    if (all(/^(true|false|yes|no|y|n|t|f)$/i) || (all(/^[01]$/) && !RX.id.test(name))) return 'boolean';
    if (all(/^\d{4}-\d{1,2}(-\d{1,2})?([ T]\d{1,2}:\d{2}(:\d{2})?)?/) || all(/^\d{1,2}[\/.]\d{1,2}[\/.]\d{2,4}/)) return 'datetime';
    if (all(/^[-+]?(\d+[.,]?\d*|\.\d+)(e[-+]?\d+)?%?$/i)) return RX.id.test(name) ? 'id' : (RX.time.test(name) && all(/^(19|20)\d{2}$/) ? 'datetime' : 'numeric');
    if (RX.id.test(name)) return 'id';
    var avg = vals.reduce(function (a, v) { return a + v.length; }, 0) / vals.length;
    if (avg > 28 || vals.some(function (v) { return v.split(/\s+/).length > 4; })) return 'text';
    return 'categorical';
  }
  /* text -> {columns, delim, rows} */
  RI.parse = function (text) {
    var lines = String(text || '').replace(/\r/g, '').split('\n').filter(function (l) { return l.trim(); });
    if (!lines.length) return { columns: [], delim: ',', rows: 0 };
    var d = delimiter(lines[0]);
    var cut = function (l) { return d === 'ws' ? l.trim().split(/\s+/) : splitLine(l, d); };
    var head = cut(lines[0]).map(function (h, i) { return h.replace(/^﻿/, '') || 'column_' + (i + 1); });
    var rows = lines.slice(1, 200).map(cut);
    var seen = {}, cols = head.map(function (name, i) {
      var n = name.slice(0, 120), k = n, j = 2;
      while (seen[k]) k = n + '_' + (j++);
      seen[k] = true;
      var vals = rows.map(function (r) { return r[i] == null ? '' : r[i]; });
      return { name: k, type: rows.length ? guessFromValues(k, vals) : guessFromName(k), role: 'feature', key: false, known: false,
               missing: rows.length ? vals.some(function (v) { return v === '' || /^(na|nan|null|none)$/i.test(v); }) : false };
    });
    RI.guessRoles(cols);
    return { columns: cols, delim: d === '\t' ? 'tab' : d === 'ws' ? 'spaces' : d, rows: rows.length };
  };
  RI.guessRoles = function (cols) {
    cols.forEach(function (c) { if (c.type === 'id') c.role = 'ignore'; });
    var time = cols.filter(function (c) { return c.type === 'datetime'; })[0];
    if (time && RX.time.test(time.name)) time.role = 'time';
    var tgt = cols.filter(function (c) { return c.role === 'feature' && RX.target.test(c.name); }).pop();
    if (!tgt) tgt = cols.filter(function (c) { return c.role === 'feature' && (c.type === 'numeric' || c.type === 'boolean'); }).pop();
    if (tgt) tgt.role = 'target';
    // A series id only makes sense when forecasting a number over time; take at most one, preferring "*_id" names.
    var forecasting = time && time.role === 'time' && tgt && tgt.type === 'numeric';
    if (forecasting) {
      var cand = cols.filter(function (c) { return (c.role === 'feature' || c.role === 'ignore') && (c.type === 'categorical' || c.type === 'id') && RX.group.test(c.name); });
      var g = cand.filter(function (c) { return /_id$|^id_/i.test(c.name); })[0] || cand[0];
      if (g) { g.role = 'group'; if (g.type === 'id') g.type = 'categorical'; }
    }
    if (time) cols.forEach(function (c) {
      if (c.role === 'feature' && /(holiday|promo|price|weekday|weekend|workday|temp|weather|forecast|planned|discount|campaign|event)/i.test(c.name)) c.known = true;
    });
    return cols;
  };
  RI.inferTask = function (cols) {
    var t = cols.filter(function (c) { return c.role === 'target'; })[0];
    var time = cols.some(function (c) { return c.role === 'time'; });
    if (!t) return 'regression';
    if (t.type === 'boolean') return 'binary';
    if (t.type === 'categorical' || t.type === 'text' || t.type === 'id') return 'multiclass';
    return time ? 'forecast' : 'regression';
  };

  /* ------------------------------------------------------------------ the spec */
  var TYPES = ['numeric', 'categorical', 'datetime', 'boolean', 'text', 'id'], ROLES = ['feature', 'target', 'time', 'group', 'ignore'];
  RI.cleanSpec = function (s) {
    s = s || {};
    var seen = {}, cols = (s.columns || []).filter(function (c) { return c && c.name && !seen[c.name] && (seen[c.name] = true); }).slice(0, 400).map(function (c) {
      return { name: String(c.name).slice(0, 120), type: TYPES.indexOf(c.type) >= 0 ? c.type : 'numeric', role: ROLES.indexOf(c.role) >= 0 ? c.role : 'feature', key: !!c.key, known: !!c.known };
    });
    var w = s.weights || {};
    var num = function (v, lo, hi, d) { v = parseFloat(v); return isNaN(v) ? d : Math.max(lo, Math.min(hi, v)); };
    return { columns: cols, task: RI.TASKS[s.task] ? s.task : 'regression', freq: RI.FREQ[s.freq] ? s.freq : 'D', horizon: Math.round(num(s.horizon, 1, 1000, 14)),
      rows: RI.ROWS[s.rows] ? s.rows : 'm', weights: { acc: num(w.acc, 0, 1, 1 / 3), interp: num(w.interp, 0, 1, 1 / 3), speed: num(w.speed, 0, 1, 1 / 3) },
      intervals: !!s.intervals, missing: !!s.missing, tune: !!s.tune, file: String(s.file || 'data.csv').slice(0, 120) };
  };
  RI.FREQ = {
    H: { name: 'Hourly', season: 24, lags: [1, 2, 3, 24, 48, 168], wins: [24, 168], alias: 'h', look: 168, unit: 'hours' },
    D: { name: 'Daily', season: 7, lags: [1, 2, 3, 7, 14, 28], wins: [7, 28], alias: 'D', look: 56, unit: 'days' },
    W: { name: 'Weekly', season: 52, lags: [1, 2, 4, 13, 52], wins: [4, 13], alias: 'W', look: 52, unit: 'weeks' },
    M: { name: 'Monthly', season: 12, lags: [1, 2, 3, 6, 12], wins: [3, 12], alias: 'MS', look: 24, unit: 'months' },
    Q: { name: 'Quarterly', season: 4, lags: [1, 2, 4, 8], wins: [4], alias: 'QS', look: 12, unit: 'quarters' },
    Y: { name: 'Yearly', season: 1, lags: [1, 2, 3], wins: [3], alias: 'YS', look: 8, unit: 'years' }
  };
  RI.derive = function (spec) {
    var cols = spec.columns || [], by = function (f) { return cols.filter(f); }, names = function (a) { return a.map(function (c) { return c.name; }); };
    var feats = by(function (c) { return c.role === 'feature' && c.type !== 'id'; });
    var of = function (t) { return feats.filter(function (c) { return c.type === t; }); };
    var d = {
      target: (by(function (c) { return c.role === 'target'; })[0] || {}).name || null,
      targetType: (by(function (c) { return c.role === 'target'; })[0] || {}).type || null,
      time: (by(function (c) { return c.role === 'time'; })[0] || {}).name || null,
      groups: names(by(function (c) { return c.role === 'group'; })),
      num: names(of('numeric')), bool: names(of('boolean')), cat: names(of('categorical')), txt: names(of('text')), dates: names(of('datetime')),
      key: names(feats.filter(function (c) { return c.key; })),
      ids: names(by(function (c) { return c.type === 'id' && c.role === 'feature'; }))
    };
    var numlike = feats.filter(function (c) { return c.type === 'numeric' || c.type === 'boolean'; });
    d.known = names(numlike.filter(function (c) { return c.known; }));
    d.past = names(numlike.filter(function (c) { return !c.known; }));
    d.keyNum = d.key.filter(function (n) { return d.num.indexOf(n) >= 0; });
    d.keyCat = d.key.filter(function (n) { return d.cat.indexOf(n) >= 0; });
    d.nFeat = feats.length;
    return d;
  };
  /* What's missing before code can be written (null if nothing). */
  RI.problem = function (spec) {
    var d = RI.derive(spec);
    if (!spec.columns || !spec.columns.length) return 'Paste a header row to begin.';
    var unsup = spec.task === 'anomaly' || spec.task === 'cluster';
    if (!d.target && !unsup) return 'Mark one column as the target y (what you want to predict).';
    if (spec.columns.filter(function (c) { return c.role === 'target'; }).length > 1) return 'Only one target, please: y is a single column.';
    if (spec.task === 'forecast' && !d.time) return 'Forecasting needs a time index t: mark your date column as Time.';
    if (spec.task === 'forecast' && d.targetType !== 'numeric' && d.targetType !== 'boolean') return 'Forecasting needs a numeric target.';
    if (spec.task === 'regression' && d.targetType !== 'numeric') return 'Regression needs a numeric target. Switch the task to classification?';
    if (spec.task === 'cluster' && !d.nFeat) return 'Clustering needs at least one feature x to group rows by.';
    if (spec.task === 'anomaly' && !d.nFeat && !(d.time && d.targetType === 'numeric')) return 'Add features x to check, or a time column t and the metric y you watch.';
    if (!unsup && spec.task !== 'forecast' && !d.nFeat && !d.time) return 'Add at least one feature x to learn from.';
    return null;
  };

  /* ------------------------------------------------------------------ the recommender
     S(m) = 20 (w_a p_m + w_i q_m + w_s r_m) / (w_a + w_i + w_s) + sum of adjustments, clipped to [0, 100] */
  RI.recommend = function (spec) {
    var d = RI.derive(spec), w = spec.weights || { acc: 1, interp: 1, speed: 1 };
    var tot = (w.acc + w.interp + w.speed) || 1, wa = w.acc / tot, wi = w.interp / tot, ws = w.speed / tot;
    var ri = RI.ROW_ORDER.indexOf(spec.rows), f = RI.FREQ[spec.freq] || RI.FREQ.D, fc = spec.task === 'forecast';
    var out = [];
    RI.MODELS.forEach(function (m) {
      if (m.tasks.indexOf(spec.task) < 0) return;
      if (m.slug === 'var' && (d.num.length + d.bool.length) < 1) return;
      if (m.slug === 'stl' && !(d.time && d.targetType === 'numeric')) return;
      if (m.tmpl === 'anom' && !d.nFeat && d.targetType !== 'numeric') return;
      var adj = [];
      var add = function (v, text) { if (v) adj.push({ v: v, text: text }); };
      if (ri < RI.ROW_ORDER.indexOf(m.minRows)) add(-14, 'Wants more data than ' + RI.ROWS[spec.rows]);
      if (ri > RI.ROW_ORDER.indexOf(m.maxRows)) add(-22, 'Scales poorly to ' + RI.ROWS[spec.rows]);
      if (spec.intervals) add(m.ivals ? 8 : -3, m.ivals ? 'Prediction intervals built in' : 'Intervals added by split conformal');
      if (spec.missing && m.miss) add(4, 'Handles missing values natively');
      if (d.cat.length && m.cat && m.tmpl === 'tab') add(2 + Math.min(d.cat.length, 3), 'Native categorical handling (' + d.cat.length + ')');
      if (d.txt.length && m.tmpl !== 'tab') add(-3, 'Ignores your text columns');
      if (d.key.length && m.interp >= 4.3) add(2, 'You can read how your ★ drivers act');
      if (spec.tune) {
        if (!RI.tunable(spec, m)) add(0.001, 'Nothing to tune: ' + (m.tmpl === 'fm' ? 'zero-shot' : spec.task === 'anomaly' && m.tmpl === 'anom' ? 'tuning needs a true/false label y' : 'it fits its own parameters'));
        else if (m.family === 'boosting' || m.family === 'neural') add(3, 'Many knobs: tuning pays off most here');
        if (m.speed <= 2 && RI.tunable(spec, m)) add(-2, 'Every trial retrains a slow model');
      }
      if (fc) {
        var drivers = d.known.length + d.past.length + d.cat.length;
        if (d.groups.length) add(m.global ? 6 : -4, m.global ? 'One global model learns across all series' : 'Fits a separate model per series');
        if (!drivers) add(m.tmpl === 'stat' || m.tmpl === 'prophet' ? 8 : -3, m.tmpl === 'stat' || m.tmpl === 'prophet' ? 'Pure univariate series: classical methods shine' : 'Only the target\'s own lags to learn from');
        if (d.known.length) add(['naive', 'ets', 'theta', 'var'].indexOf(m.slug) >= 0 ? -6 : 3, ['naive', 'ets', 'theta', 'var'].indexOf(m.slug) >= 0 ? 'Ignores your known-ahead drivers' : 'Uses your known-ahead drivers');
        if (d.past.length && (m.tmpl === 'tab' || m.tmpl === 'torch')) add(2, 'Uses lags of your past-only drivers');
        if (spec.freq === 'H' && m.slug === 'arima') add(-8, 'Seasonal ARIMA is slow with 24-step seasons');
        if (spec.horizon > 3 * Math.max(f.season, 4) && m.tmpl === 'tab') add(-3, 'Long horizon: recursive errors compound');
        if (m.slug === 'naive') add(0.001, 'The benchmark every model has to beat');
      } else if (spec.task === 'anomaly') {
        if (m.slug === 'stl') add(8, 'Your metric over time: remove the season, flag surprises');
        if (d.time && m.tmpl === 'anom') add(-2, 'Treats rows as independent (time only as calendar parts)');
        if (d.cat.length > 2 && m.slug === 'robustcov') add(-5, 'One-hot categories break the ellipse');
        if (d.num.length + d.bool.length > 30 && (m.slug === 'lof' || m.slug === 'ocsvm')) add(-5, 'Distances blur in high dimensions');
        if (m.slug === 'iforest') add(2, 'The usual first detector');
      } else if (spec.task === 'cluster') {
        if (['l', 'xl'].indexOf(spec.rows) >= 0 && m.slug === 'kmeans') add(4, 'Scales to millions of rows');
        if (m.slug === 'hdbscan') add(2, 'Finds the number of clusters itself, and flags noise');
        if (d.cat.length > d.num.length && m.slug !== 'kmeans') add(-2, 'Mostly categorical: distances get coarse');
      } else {
        if (spec.rows === 'xs' && m.family === 'boosting' && m.slug !== 'catboost') add(-4, 'Can overfit very small data');
        if (d.num.length + d.bool.length > 30 && m.slug === 'knn') add(-6, 'Curse of dimensionality');
        if (spec.task === 'multiclass' && m.slug === 'gp') add(-6, 'Slow and clumsy for many classes');
      }
      var parts = { acc: 20 * wa * m.power, interp: 20 * wi * m.interp, speed: 20 * ws * m.speed };
      var base = parts.acc + parts.interp + parts.speed;
      var score = Math.max(0, Math.min(100, base + adj.reduce(function (a, x) { return a + x.v; }, 0)));
      var badges = [];
      if (m.family === 'baseline' || m.slug === 'linreg' || m.slug === 'logreg') badges.push(['Baseline', '']);
      if (['lgbm', 'catboost', 'hgb'].indexOf(m.slug) >= 0) badges.push(['Strong default', 'brand']);
      if (m.interp >= 4.3) badges.push(['Interpretable', 'good']);
      if (m.ivals) badges.push(['Uncertainty', 'warn']);
      if (m.tmpl === 'fm') badges.push(['Zero-shot', 'brand']);
      out.push({ model: m, score: score, base: base, parts: parts, adj: adj.filter(function (a) { return Math.abs(a.v) >= 0.5 || a.v === 0.001; }), badges: badges });
    });
    out.sort(function (a, b) { return b.score - a.score; });
    return out;
  };

  /* ------------------------------------------------------------------ code generation */
  var py = function (s) { return JSON.stringify(String(s)); };
  function pyList(arr, indentLen) {
    if (!arr.length) return '[]';
    var items = arr.map(py), one = '[' + items.join(', ') + ']';
    if (one.length + (indentLen || 0) <= 96) return one;
    var lines = [], cur = '';
    items.forEach(function (it) {
      if (cur && (cur + ', ' + it).length > 84) { lines.push(cur + ','); cur = it; } else cur = cur ? cur + ', ' + it : it;
    });
    lines.push(cur);
    return '[\n    ' + lines.join('\n    ') + ',\n]';
  }
  function today() { var d = new Date(); return d.toISOString().slice(0, 10); }
  function uniq(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }

  /* Estimators for the 'tab' template: [regressor, classifier] constructor code, imports, flags. */
  var EST = {
    linreg: { imp: 'from sklearn.linear_model import LinearRegression', reg: 'LinearRegression()' },
    ridge: { imp: 'from sklearn.linear_model import Ridge', reg: 'Ridge(alpha=1.0)  # tune alpha on a log grid: 1e-3 ... 1e3' },
    lasso: { imp: 'from sklearn.linear_model import Lasso', reg: 'Lasso(alpha=0.01, max_iter=10000)' },
    enet: { imp: 'from sklearn.linear_model import ElasticNet', reg: 'ElasticNet(alpha=0.01, l1_ratio=0.5, max_iter=10000)' },
    logreg: { imp: 'from sklearn.linear_model import LogisticRegression', clf: 'LogisticRegression(C=1.0, max_iter=3000, class_weight="balanced")' },
    glm: { imp: 'from sklearn.linear_model import PoissonRegressor', reg: 'PoissonRegressor(alpha=1e-3, max_iter=2000)  # or TweedieRegressor(power=1.5, link="log")' },
    bayesridge: { imp: 'from sklearn.linear_model import BayesianRidge', reg: 'BayesianRidge()', dense: true, std: true },
    knn: { imp: 'from sklearn.neighbors import KNeighborsClassifier, KNeighborsRegressor', reg: 'KNeighborsRegressor(n_neighbors=15, weights="distance")', clf: 'KNeighborsClassifier(n_neighbors=15, weights="distance")' },
    svm: { imp: 'from sklearn.svm import SVC, SVR', reg: 'SVR(C=10.0, epsilon=0.1, gamma="scale")', clf: 'SVC(C=10.0, gamma="scale", probability=True, class_weight="balanced", random_state=SEED)' },
    gp: { imp: 'from sklearn.gaussian_process import GaussianProcessClassifier, GaussianProcessRegressor\nfrom sklearn.gaussian_process.kernels import RBF, ConstantKernel, WhiteKernel',
      reg: 'GaussianProcessRegressor(\n        kernel=ConstantKernel(1.0) * RBF(length_scale=1.0) + WhiteKernel(noise_level=0.1),\n        normalize_y=True, n_restarts_optimizer=3, random_state=SEED)',
      clf: 'GaussianProcessClassifier(kernel=1.0 * RBF(1.0), random_state=SEED)', dense: true, std: true },
    nb: { imp: 'from sklearn.naive_bayes import GaussianNB', clf: 'GaussianNB()', dense: true },
    tree: { imp: 'from sklearn.tree import DecisionTreeClassifier, DecisionTreeRegressor', reg: 'DecisionTreeRegressor(max_depth=8, min_samples_leaf=20, random_state=SEED)', clf: 'DecisionTreeClassifier(max_depth=8, min_samples_leaf=20, class_weight="balanced", random_state=SEED)', tree: true },
    rf: { imp: 'from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor', reg: 'RandomForestRegressor(n_estimators=500, min_samples_leaf=2, max_features=0.5, n_jobs=-1, random_state=SEED)', clf: 'RandomForestClassifier(n_estimators=500, min_samples_leaf=2, class_weight="balanced_subsample", n_jobs=-1, random_state=SEED)', tree: true },
    extra: { imp: 'from sklearn.ensemble import ExtraTreesClassifier, ExtraTreesRegressor', reg: 'ExtraTreesRegressor(n_estimators=500, min_samples_leaf=2, max_features=0.7, n_jobs=-1, random_state=SEED)', clf: 'ExtraTreesClassifier(n_estimators=500, min_samples_leaf=2, class_weight="balanced_subsample", n_jobs=-1, random_state=SEED)', tree: true },
    hgb: { imp: 'from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor', reg: 'HistGradientBoostingRegressor(\n        learning_rate=0.05, max_iter=1000, max_leaf_nodes=31, l2_regularization=1.0,\n        early_stopping=True, categorical_features=CAT_INDEX, random_state=SEED)', clf: 'HistGradientBoostingClassifier(\n        learning_rate=0.05, max_iter=1000, max_leaf_nodes=31, l2_regularization=1.0,\n        early_stopping=True, categorical_features=CAT_INDEX, class_weight="balanced", random_state=SEED)', tree: true, nan: true, dense: true },
    xgb: { imp: 'from xgboost import XGBClassifier, XGBRegressor', reg: 'XGBRegressor(\n        n_estimators=1000, learning_rate=0.03, max_depth=6, subsample=0.8, colsample_bytree=0.8,\n        reg_lambda=1.0, tree_method="hist", n_jobs=-1, random_state=SEED)', clf: 'XGBClassifier(\n        n_estimators=1000, learning_rate=0.03, max_depth=6, subsample=0.8, colsample_bytree=0.8,\n        reg_lambda=1.0, tree_method="hist", n_jobs=-1, random_state=SEED)', tree: true, nan: true },
    lgbm: { imp: 'from lightgbm import LGBMClassifier, LGBMRegressor', reg: 'LGBMRegressor(\n        n_estimators=1500, learning_rate=0.03, num_leaves=63, min_child_samples=20,\n        subsample=0.8, subsample_freq=1, colsample_bytree=0.8, random_state=SEED, verbose=-1)', clf: 'LGBMClassifier(\n        n_estimators=1500, learning_rate=0.03, num_leaves=63, min_child_samples=20,\n        subsample=0.8, subsample_freq=1, colsample_bytree=0.8, class_weight="balanced",\n        random_state=SEED, verbose=-1)', tree: true, nan: true },
    qgbm: { imp: 'from lightgbm import LGBMRegressor', reg: 'LGBMRegressor(\n        objective="quantile", alpha=alpha, n_estimators=1500, learning_rate=0.03, num_leaves=63,\n        min_child_samples=20, subsample=0.8, subsample_freq=1, colsample_bytree=0.8, random_state=SEED, verbose=-1)', tree: true, nan: true, quant: true },
    catboost: { imp: 'from catboost import CatBoostClassifier, CatBoostRegressor', reg: 'CatBoostRegressor(\n        iterations=2000, learning_rate=0.05, depth=6, l2_leaf_reg=3, loss_function="RMSE",\n        cat_features=CAT_FEATURES, random_seed=SEED, verbose=250)', clf: 'CatBoostClassifier(\n        iterations=2000, learning_rate=0.05, depth=6, l2_leaf_reg=3, auto_class_weights="Balanced",\n        cat_features=CAT_FEATURES, text_features=TEXT or None, random_seed=SEED, verbose=250)', cat: true },
    mlp: { imp: 'from sklearn.neural_network import MLPClassifier, MLPRegressor', reg: 'MLPRegressor(hidden_layer_sizes=(128, 64), alpha=1e-4, early_stopping=True, max_iter=500, random_state=SEED)', clf: 'MLPClassifier(hidden_layer_sizes=(128, 64), alpha=1e-4, early_stopping=True, max_iter=500, random_state=SEED)' }
  };

  /* ---------- cross-validated tuning (Optuna): search spaces and shared Python pieces */
  var LR = '"learning_rate": trial.suggest_float("learning_rate", 0.01, 0.3, log=True)';
  var SUB = ['"subsample": trial.suggest_float("subsample", 0.5, 1.0)', '"colsample_bytree": trial.suggest_float("colsample_bytree", 0.5, 1.0)', '"reg_lambda": trial.suggest_float("reg_lambda", 1e-3, 10.0, log=True)'];
  var FOREST = ['"max_features": trial.suggest_float("max_features", 0.2, 1.0)', '"min_samples_leaf": trial.suggest_int("min_samples_leaf", 1, 20, log=True)', '"max_depth": trial.suggest_categorical("max_depth", [None, 8, 16, 32])'];
  var LGB = [LR, '"num_leaves": trial.suggest_int("num_leaves", 8, 256, log=True)', '"min_child_samples": trial.suggest_int("min_child_samples", 5, 100, log=True)'].concat(SUB);
  var SPACE = {
    ridge: ['"alpha": trial.suggest_float("alpha", 1e-3, 1e3, log=True)'],
    lasso: ['"alpha": trial.suggest_float("alpha", 1e-4, 1.0, log=True)'],
    enet: ['"alpha": trial.suggest_float("alpha", 1e-4, 1.0, log=True)', '"l1_ratio": trial.suggest_float("l1_ratio", 0.05, 0.95)'],
    logreg: ['"C": trial.suggest_float("C", 1e-3, 100.0, log=True)'],
    glm: ['"alpha": trial.suggest_float("alpha", 1e-4, 1.0, log=True)'],
    knn: ['"n_neighbors": trial.suggest_int("n_neighbors", 3, 60, log=True)', '"weights": trial.suggest_categorical("weights", ["uniform", "distance"])'],
    svm: ['"C": trial.suggest_float("C", 0.1, 100.0, log=True)', '"gamma": trial.suggest_float("gamma", 1e-4, 1.0, log=True)'],
    nb: ['"var_smoothing": trial.suggest_float("var_smoothing", 1e-12, 1e-6, log=True)'],
    tree: ['"max_depth": trial.suggest_int("max_depth", 2, 16)', '"min_samples_leaf": trial.suggest_int("min_samples_leaf", 1, 100, log=True)'],
    rf: FOREST, extra: FOREST,
    hgb: [LR, '"max_leaf_nodes": trial.suggest_int("max_leaf_nodes", 8, 128, log=True)', '"min_samples_leaf": trial.suggest_int("min_samples_leaf", 5, 100, log=True)', '"l2_regularization": trial.suggest_float("l2_regularization", 1e-3, 10.0, log=True)'],
    xgb: [LR, '"max_depth": trial.suggest_int("max_depth", 3, 10)', '"min_child_weight": trial.suggest_float("min_child_weight", 1.0, 20.0, log=True)'].concat(SUB),
    lgbm: LGB, qgbm: LGB,
    catboost: [LR, '"depth": trial.suggest_int("depth", 4, 10)', '"l2_leaf_reg": trial.suggest_float("l2_leaf_reg", 1.0, 30.0, log=True)', '"verbose": 0  # quiet during the search'],
    mlp: ['"hidden_layer_sizes": (trial.suggest_int("width", 32, 256, log=True),) * trial.suggest_int("layers", 1, 3)', '"alpha": trial.suggest_float("alpha", 1e-6, 1e-2, log=True)', '"learning_rate_init": trial.suggest_float("learning_rate_init", 1e-4, 1e-2, log=True)'],
    // classical forecasters (fit_forecast(hist, fut, params))
    arima: ['"order": (trial.suggest_int("p", 0, 3), trial.suggest_int("d", 0, 1), trial.suggest_int("q", 0, 3))', '"seasonal": trial.suggest_categorical("seasonal", [True, False])'],
    ets: ['"trend": trial.suggest_categorical("trend", ["add", None])', '"damped": trial.suggest_categorical("damped", [True, False])', '"seasonal": trial.suggest_categorical("seasonal", ["add", "mul", None])'],
    theta: ['"theta": trial.suggest_float("theta", 0.5, 4.0)'],
    prophet: ['"changepoint_prior_scale": trial.suggest_float("changepoint_prior_scale", 1e-3, 0.5, log=True)', '"seasonality_prior_scale": trial.suggest_float("seasonality_prior_scale", 0.01, 10.0, log=True)', '"seasonality_mode": trial.suggest_categorical("seasonality_mode", ["additive", "multiplicative"])'],
    var: ['"maxlags": trial.suggest_int("maxlags", 1, max(2, SEASON))'],
    // networks
    torch: ['"hidden": trial.suggest_categorical("hidden", [32, 64, 128])', '"lr": trial.suggest_float("lr", 1e-4, 3e-3, log=True)'],
    // anomaly detectors (scored against the label)
    iforest: ['"n_estimators": trial.suggest_int("n_estimators", 100, 500, step=50)', '"max_samples": trial.suggest_int("max_samples", 64, 2048, log=True)', '"max_features": trial.suggest_float("max_features", 0.3, 1.0)'],
    lof: ['"n_neighbors": trial.suggest_int("n_neighbors", 5, 100, log=True)'],
    ocsvm: ['"nu": trial.suggest_float("nu", 1e-3, 0.3, log=True)', '"gamma": trial.suggest_float("gamma", 1e-4, 1.0, log=True)'],
    robustcov: ['"support_fraction": trial.suggest_float("support_fraction", 0.5, 1.0)'],
    // clustering (scored by silhouette)
    kmeans: ['"n_clusters": trial.suggest_int("n_clusters", 2, 12)'],
    gmm: ['"n_components": trial.suggest_int("n_components", 2, 12)', '"covariance_type": trial.suggest_categorical("covariance_type", ["full", "diag", "tied", "spherical"])'],
    hdbscan: ['"min_cluster_size": trial.suggest_int("min_cluster_size", 5, 200, log=True)', '"min_samples": trial.suggest_int("min_samples", 1, 50, log=True)'],
    agglo: ['"n_clusters": trial.suggest_int("n_clusters", 2, 12)', '"linkage": trial.suggest_categorical("linkage", ["ward", "average", "complete"])']
  };
  /* Can the "cross-validated tuning" option do anything for this model on this data? */
  RI.tunable = function (spec, m) {
    if (!m || m.tmpl === 'fm' || m.tmpl === 'anomts') return false;
    if (m.tmpl === 'anom') return RI.derive(spec).targetType === 'boolean';
    return !!SPACE[m.tmpl === 'torch' ? 'torch' : m.slug];
  };
  function tuneConfig(trials, timeout, folds, what) {
    return ['TUNE = True  # ' + what + '; False = keep the defaults', 'TUNE_TRIALS = ' + trials + '  # Optuna trials',
      'TUNE_TIMEOUT = ' + timeout + '  # seconds: the search stops at whichever limit comes first'].concat(folds ? ['FOLDS = ' + folds] : []);
  }
  function spaceFn(lines) {
    return ['def search_space(trial):', '    """The hyperparameters Optuna explores (typical ranges from the RoboIntern Atlas)."""', '    return {']
      .concat(lines.map(function (l) { var i = l.indexOf('  #'); return i > 0 ? '        ' + l.slice(0, i) + ',' + l.slice(i) : '        ' + l + ','; }))
      .concat(['    }', '', '']);
  }
  var WITH_PARAMS = ['def with_params(model, params):', '    """Apply hyperparameters to a fresh model (to the estimator inside the pipeline, if there is one)."""',
    '    if hasattr(model, "named_steps"):', '        return model.set_params(**{"model__" + k: v for k, v in params.items()})', '    return model.set_params(**params)', '', ''];
  function studyLines(direction, what) {
    return ['    optuna.logging.set_verbosity(optuna.logging.WARNING)',
      '    study = optuna.create_study(direction="' + direction + '", sampler=optuna.samplers.TPESampler(seed=SEED))',
      '    study.optimize(objective, n_trials=TUNE_TRIALS, timeout=TUNE_TIMEOUT)',
      '    best = search_space(optuna.trial.FixedTrial(study.best_params))',
      '    print(f"  best ' + what + ' {study.best_value:.4f} after {len(study.trials)} trials:")',
      '    for k, v in best.items():', '        print(f"    {k} = {v}")', '    return best'];
  }

  function header(spec, m, d, title, lines) {
    var task = { forecast: 'Forecast ' + spec.horizon + ' ' + RI.FREQ[spec.freq].unit + ' ahead', regression: 'Regression', binary: 'Binary classification', multiclass: 'Multiclass classification', anomaly: 'Anomaly detection', cluster: 'Clustering' }[spec.task];
    var what = spec.task === 'cluster' ? (d.target ? ', `' + d.target + '` only describes the clusters' : '') : spec.task === 'anomaly' ? (d.target ? (d.targetType === 'boolean' ? ', label `' + d.target + '` only to measure' : ', watching `' + d.target + '`') : '') : ', target `' + d.target + '`';
    return ['"""', title, '', 'Model:  ' + m.name + ' (' + m.lib + ')', 'Task:   ' + task + what,
      'Data:   ' + spec.file + ' (' + spec.columns.length + ' described columns)', '',
      'Written by RoboIntern on ' + today() + '. Read it, run it, change it: it is yours.'].concat(lines || []).concat(['"""']).join('\n');
  }
  function boolParse() {
    return 'TRUTHY = {"1": 1.0, "1.0": 1.0, "true": 1.0, "t": 1.0, "yes": 1.0, "y": 1.0,\n          "0": 0.0, "0.0": 0.0, "false": 0.0, "f": 0.0, "no": 0.0, "n": 0.0}';
  }
  function req(m, extra, tuned) {
    var r = ['numpy>=1.24', 'pandas>=2.0'].concat(extra || []);
    var map = { 'scikit-learn': 'scikit-learn>=1.4', xgboost: 'xgboost>=2.0', lightgbm: 'lightgbm>=4.0,!=4.7.0  # 4.7.0 crashes on Windows with pandas input', catboost: 'catboost>=1.2', statsmodels: 'statsmodels>=0.14', prophet: 'prophet>=1.1', torch: 'torch>=2.1', optuna: 'optuna>=3.6', 'chronos-forecasting': 'chronos-forecasting>=2.2', timesfm: 'timesfm[torch]>=2.0' };
    (m.pip || []).concat(tuned ? ['optuna'] : []).forEach(function (p) { r.push(map[p] || p); });
    return '# pip install -r requirements.txt\n' + uniq(r).join('\n') + '\n';
  }

  /* ---------- template: tabular regression / classification */
  function genTab(spec, m, d, title) {
    var e = EST[m.slug], clf = spec.task !== 'regression', bin = spec.task === 'binary';
    var linear = m.family === 'linear' || m.slug === 'bayesridge' || m.slug === 'mlp';
    var dates = uniq(d.dates.concat(d.time ? [d.time] : []));
    var eng = [], engCat = [];
    dates.forEach(function (c) { eng.push(c + '_year', c + '_month_sin', c + '_month_cos', c + '_dow'); });
    var kn = d.keyNum;
    for (var i = 0; i < kn.length; i++) for (var j = i + 1; j < kn.length && eng.length < 40; j++) eng.push(kn[i] + '_x_' + kn[j]);
    if (linear) kn.forEach(function (c) { eng.push(c + '_sq'); });
    if (d.keyCat.length >= 2) engCat.push(d.keyCat[0] + '__' + d.keyCat[1]);
    var text = (m.slug === 'catboost' && !clf) ? [] : d.txt;
    var ivals = spec.intervals && !clf;
    var tuned = spec.tune && RI.tunable(spec, m), cvName = d.time ? 'TimeSeriesSplit' : clf ? 'StratifiedKFold' : 'KFold';
    var scoring = !clf ? 'neg_mean_absolute_error' : bin ? 'roc_auc' : 'balanced_accuracy';
    var L = [];
    L.push(header(spec, m, d, title, ['', 'Run:', '    pip install -r requirements.txt', '    python train.py             # ' + (tuned ? 'tunes by cross-validation, ' : '') + 'evaluates on a holdout, then trains on everything -> model.joblib',
      '    python predict.py new.csv   # predictions for new rows -> predictions.csv']));
    L.push('import warnings', '', 'import joblib', 'import numpy as np');
    if (tuned) L.push('import optuna');
    L.push('import pandas as pd');
    if (!e.cat) L.push('from sklearn.compose import ColumnTransformer');
    if (!e.cat && text.length && e.dense) L.push('from sklearn.decomposition import TruncatedSVD');
    if (!e.cat && text.length) L.push('from sklearn.feature_extraction.text import TfidfVectorizer');
    if (!e.cat && !e.nan) L.push('from sklearn.impute import SimpleImputer');
    L.push('from sklearn.inspection import permutation_importance');
    L.push(clf ? 'from sklearn.metrics import accuracy_score, balanced_accuracy_score, f1_score, log_loss, roc_auc_score'
      : 'from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score');
    L.push('from sklearn.model_selection import ' + (tuned ? [cvName, 'cross_val_score', 'train_test_split'].sort().join(', ') : 'train_test_split'));
    if (!e.cat) L.push('from sklearn.pipeline import Pipeline');
    var pre = [];
    if (clf) pre.push('LabelEncoder');
    if (!e.cat) pre.push(e.tree ? 'OrdinalEncoder' : 'OneHotEncoder');
    if (!e.cat && !e.tree) pre.push('StandardScaler');
    if (pre.length) L.push('from sklearn.preprocessing import ' + pre.sort().join(', '));
    L.push(e.imp, '', 'warnings.filterwarnings("ignore")', '');
    L.push('DATA = ' + py(spec.file));
    L.push('TARGET = ' + py(d.target));
    L.push('TIME = ' + (d.time ? py(d.time) + '  # rows are split by time, so the model is tested on the future it never saw' : 'None'));
    L.push('NUMERIC = ' + pyList(d.num, 10));
    L.push('BOOLEAN = ' + pyList(d.bool, 10));
    L.push('CATEGORICAL = ' + pyList(d.cat, 14));
    L.push('TEXT = ' + pyList(text, 7) + (d.txt.length && !text.length ? '  # CatBoost regression: text columns left out' : ''));
    L.push('DATES = ' + pyList(d.dates, 8));
    L.push('KEY_DRIVERS = ' + pyList(d.key, 14) + '  # ★ the columns you highlighted');
    if (d.ids.length) L.push('# id columns are never features (they would only memorise rows): ' + d.ids.join(', '));
    L.push('ENGINEERED = ' + pyList(eng, 13) + '  # made in add_features()');
    if (engCat.length) L.push('ENGINEERED_CAT = ' + pyList(engCat, 17));
    L.push('NUM_FEATURES = NUMERIC + BOOLEAN + ENGINEERED');
    L.push('CAT_FEATURES = CATEGORICAL' + (engCat.length ? ' + ENGINEERED_CAT' : ''));
    L.push('FEATURES = NUM_FEATURES + CAT_FEATURES + TEXT');
    if (e.nan && m.slug === 'hgb') L.push('CAT_INDEX = list(range(len(NUM_FEATURES), len(NUM_FEATURES) + len(CAT_FEATURES)))  # columns after the numeric block');
    L.push('SEED = 42', 'TEST_SIZE = 0.2');
    if (ivals && !e.std && !e.quant) L.push('COVERAGE = 0.9  # split-conformal interval: about 90% of new values should land inside');
    if (tuned) L = L.concat(tuneConfig(40, 900, 5, 'cross-validated Optuna search on the training rows first'), ['SCORING = ' + py(scoring) + '  # what the search maximises']);
    L.push('', boolParse(), '', '');
    L.push('def load(path):', '    df = pd.read_csv(path)', '    for c in DATES + ([TIME] if TIME else []):', '        df[c] = pd.to_datetime(df[c], errors="coerce")', '    return df', '', '');
    L.push('def add_features(df):', '    """Feature development. Runs on training data and on new data alike, so it never reads the target."""', '    df = df.copy()');
    L.push('    for c in NUMERIC:', '        df[c] = pd.to_numeric(df[c], errors="coerce")');
    L.push('    for c in BOOLEAN:', '        df[c] = df[c].astype(str).str.strip().str.lower().map(TRUTHY)');
    L.push('    for c in CATEGORICAL:', '        df[c] = df[c].fillna("NA").astype(str)');
    L.push('    for c in TEXT:', '        df[c] = df[c].fillna("").astype(str)');
    if (dates.length) {
      L.push('    for c in DATES + ([TIME] if TIME else []):  # calendar parts; months on a circle so Dec sits next to Jan',
        '        d = df[c]', '        df[c + "_year"] = d.dt.year', '        df[c + "_month_sin"] = np.sin(2 * np.pi * d.dt.month / 12)',
        '        df[c + "_month_cos"] = np.cos(2 * np.pi * d.dt.month / 12)', '        df[c + "_dow"] = d.dt.dayofweek');
    }
    if (eng.some(function (n) { return n.indexOf('_x_') > 0; }) || (linear && kn.length) || engCat.length) {
      L.push('    # ★ key drivers: let the model see how they combine');
      for (var a = 0; a < kn.length; a++) for (var b = a + 1; b < kn.length; b++) if (eng.indexOf(kn[a] + '_x_' + kn[b]) >= 0) L.push('    df[' + py(kn[a] + '_x_' + kn[b]) + '] = df[' + py(kn[a]) + '] * df[' + py(kn[b]) + ']');
      if (linear) kn.forEach(function (c) { L.push('    df[' + py(c + '_sq') + '] = df[' + py(c) + '] ** 2  # a curve, for a linear model'); });
      if (engCat.length) L.push('    df[' + py(engCat[0]) + '] = df[' + py(d.keyCat[0]) + '] + "|" + df[' + py(d.keyCat[1]) + ']');
    }
    L.push('    return df', '', '');
    // the model
    var est = clf ? e.clf : e.reg;
    if (e.cat) {
      L.push('def make_model():', '    # CatBoost takes the raw columns: categoricals as strings' + (text.length ? ', text as text' : '') + ', missing numbers as NaN.', '    return ' + est, '', '');
    } else {
      L.push(e.quant ? 'def make_model(alpha=0.5):' : 'def make_model():');
      if (e.nan) L.push('    numeric = "passthrough"  # missing values are handled by the trees themselves');
      else L.push('    numeric = Pipeline([', '        ("impute", SimpleImputer(strategy="median", add_indicator=True)),' + (e.tree ? '' : '\n        ("scale", StandardScaler()),'), '    ])');
      if (e.tree) L.push('    categorical = OrdinalEncoder(handle_unknown="use_encoded_value", unknown_value=-1, encoded_missing_value=-1' + (m.slug === 'hgb' ? ', max_categories=250' : '') + ')');
      else L.push('    categorical = OneHotEncoder(handle_unknown="infrequent_if_exist", min_frequency=10' + (e.dense ? ', sparse_output=False' : '') + ')');
      L.push('    parts = [("num", numeric, NUM_FEATURES), ("cat", categorical, CAT_FEATURES)]');
      if (text.length) {
        L.push('    for c in TEXT:');
        if (e.dense) L.push('        tfidf = TfidfVectorizer(max_features=5000, ngram_range=(1, 2), min_df=2)', '        parts.append(("txt_" + c, Pipeline([("tfidf", tfidf), ("svd", TruncatedSVD(32, random_state=SEED))]), c))');
        else L.push('        parts.append(("txt_" + c, TfidfVectorizer(max_features=5000, ngram_range=(1, 2), min_df=2), c))');
      }
      L.push('    prep = ColumnTransformer(parts' + (e.dense ? ', sparse_threshold=0' : '') + ')');
      L.push('    model = ' + est, '    return Pipeline([("prep", prep), ("model", model)])', '', '');
    }
    if (!clf) {
      L.push('def predict_rows(model, X):', '    """Point prediction, plus an interval when the model can give one (else None, None)."""');
      if (e.quant) L.push('    mid, lo, hi = (model[q].predict(X) for q in ("mid", "lo", "hi"))', '    return mid, np.minimum(lo, mid), np.maximum(hi, mid)  # quantiles must not cross');
      else if (e.std) L.push('    mean, std = model.predict(X, return_std=True)', '    return mean, mean - 1.645 * std, mean + 1.645 * std  # 90% Gaussian interval');
      else L.push('    return model.predict(X), None, None');
      L.push('', '');
    }
    if (tuned) {
      L = L.concat(spaceFn(SPACE[m.slug].concat(m.slug === 'svm' && !clf ? ['"epsilon": trial.suggest_float("epsilon", 0.01, 1.0, log=True)'] : [])), WITH_PARAMS);
      L.push('def tune(X, y):', '    """Cross-validated Optuna search on the training rows only, so the holdout stays unseen."""',
        '    cv = ' + (d.time ? 'TimeSeriesSplit(FOLDS)  # rows are in time order: always validate on the future' : cvName + '(FOLDS, shuffle=True, random_state=SEED)'), '',
        '    def objective(trial):', '        model = with_params(make_model(), search_space(trial))',
        '        return np.nanmean(cross_val_score(model, X, y, cv=cv, scoring=SCORING))', '');
      L = L.concat(studyLines('maximize', 'CV {SCORING}'), ['', '']);
    }
    if (e.quant) L.push('def fit(X, y' + (tuned ? ', params=None' : '') + '):', '    """Three LightGBM models on the pinball loss: P10, P50, P90."""', '    return {name: ' + (tuned ? 'with_params(make_model(alpha), params or {})' : 'make_model(alpha)') + '.fit(X, y) for name, alpha in (("lo", 0.1), ("mid", 0.5), ("hi", 0.9))}', '', '');
    else if (tuned) L.push('def fit(X, y, params=None):', '    return with_params(make_model(), params or {}).fit(X, y)', '', '');
    else L.push('def fit(X, y):', '    return make_model().fit(X, y)', '', '');
    // split
    L.push('def split(df):');
    L.push('    if TIME:', '        df = df.sort_values(TIME)', '        cut = int(len(df) * (1 - TEST_SIZE))', '        return df.iloc[:cut], df.iloc[cut:]');
    if (clf) L.push('    strat = df[TARGET] if df[TARGET].value_counts().min() >= 2 else None', '    return train_test_split(df, test_size=TEST_SIZE, random_state=SEED, stratify=strat)');
    else L.push('    return train_test_split(df, test_size=TEST_SIZE, random_state=SEED)');
    L.push('', '');
    // evaluation
    if (clf) {
      L.push('def evaluate(model, X, y, y_train, classes):');
      L.push('    pred = np.asarray(model.predict(X)).ravel().astype(int)');
      L.push('    proba = model.predict_proba(X) if hasattr(model, "predict_proba") else None');
      L.push('    majority = np.bincount(y_train).argmax()');
      L.push('    print(f"  accuracy           {accuracy_score(y, pred):.4f}   (always \'{classes[majority]}\': {np.mean(y == majority):.4f})")');
      L.push('    print(f"  balanced accuracy  {balanced_accuracy_score(y, pred):.4f}")');
      L.push('    print(f"  F1 (macro)         {f1_score(y, pred, average=\'macro\'):.4f}")');
      L.push('    if proba is not None:');
      if (bin) L.push('        print(f"  ROC AUC            {roc_auc_score(y, proba[:, 1]):.4f}   (0.5 = coin flip)")');
      else L.push('        if len(np.unique(y)) == proba.shape[1]:', '            print(f"  ROC AUC (ovr)      {roc_auc_score(y, proba, multi_class=\'ovr\'):.4f}")');
      L.push('        print(f"  log loss           {log_loss(y, proba, labels=list(range(len(classes)))):.4f}")');
    } else {
      L.push('def evaluate(model, X, y, y_train):');
      L.push('    pred, lo, hi = predict_rows(model, X)');
      L.push('    mae = mean_absolute_error(y, pred)');
      L.push('    base = mean_absolute_error(y, np.full(len(y), y_train.mean()))');
      L.push('    print(f"  MAE   {mae:,.4f}   (predicting the mean: {base:,.4f}, skill {1 - mae / base:+.1%})")');
      L.push('    print(f"  RMSE  {np.sqrt(mean_squared_error(y, pred)):,.4f}")');
      L.push('    print(f"  R^2   {r2_score(y, pred):.4f}")');
      if (ivals && (e.std || e.quant)) L.push('    print(f"  interval coverage {np.mean((y >= lo) & (y <= hi)):.1%}, mean width {np.mean(hi - lo):,.4f}")');
      L.push('    return y - pred');
    }
    L.push('', '');
    L.push('def explain(model, X, y):', '    """Permutation importance on held-out rows: how much the score drops when a column is shuffled."""');
    L.push('    X, y = X.iloc[:2000], y[:2000]');
    L.push('    est = model["mid"] if isinstance(model, dict) else model');
    L.push('    r = permutation_importance(est, X, y, n_repeats=3, random_state=SEED, scoring="' + (clf ? 'balanced_accuracy' : 'neg_mean_absolute_error') + '")');
    L.push('    order = np.argsort(r.importances_mean)[::-1][:12]');
    L.push('    for i in order:', '        star = "  (key driver)" if X.columns[i] in KEY_DRIVERS else ""', '        print(f"  {X.columns[i]:<32} {r.importances_mean[i]:+.4f}{star}")', '', '');
    // main
    L.push('def main():');
    L.push('    df = add_features(load(DATA))');
    if (clf) {
      L.push('    df = df.dropna(subset=[TARGET])', '    df[TARGET] = df[TARGET].astype(str)');
      L.push('    encoder = LabelEncoder().fit(df[TARGET])');
      if (bin) L.push('    if len(encoder.classes_) != 2:', '        raise SystemExit(f"Binary task, but {TARGET} has {len(encoder.classes_)} classes: {list(encoder.classes_)[:10]}")');
      L.push('    print(f"{len(df):,} rows, classes: {list(encoder.classes_)[:12]}" + ("  (positive = \'" + encoder.classes_[1] + "\')" if len(encoder.classes_) == 2 else ""))');
      L.push('    train, test = split(df)');
      L.push('    y_train, y_test = encoder.transform(train[TARGET]), encoder.transform(test[TARGET])');
      if (tuned) L.push('    params = {}', '    if TUNE:', '        print(f"\\nTuning ({FOLDS}-fold CV, up to {TUNE_TRIALS} trials):")', '        params = tune(train[FEATURES], y_train)');
      L.push('    model = fit(train[FEATURES], y_train' + (tuned ? ', params' : '') + ')');
      L.push('    print(f"\\nHoldout ({len(test):,} rows):")');
      L.push('    evaluate(model, test[FEATURES], y_test, y_train, encoder.classes_)');
      L.push('    print("\\nWhat the model leans on:")', '    explain(model, test[FEATURES], y_test)');
      L.push('', '    final = fit(df[FEATURES], encoder.transform(df[TARGET])' + (tuned ? ', params' : '') + ')  # all data for the model you deploy');
      L.push('    joblib.dump({"model": final, "features": FEATURES, "encoder": encoder' + (tuned ? ', "params": params' : '') + '}, "model.joblib")');
    } else {
      L.push('    df[TARGET] = pd.to_numeric(df[TARGET], errors="coerce")', '    df = df.dropna(subset=[TARGET])');
      L.push('    print(f"{len(df):,} rows, {TARGET}: mean {df[TARGET].mean():,.3f}, sd {df[TARGET].std():,.3f}")');
      L.push('    train, test = split(df)');
      if (tuned) L.push('    params = {}', '    if TUNE:', '        print(f"\\nTuning ({FOLDS}-fold CV, up to {TUNE_TRIALS} trials):")', '        params = tune(train[FEATURES], train[TARGET])');
      L.push('    model = fit(train[FEATURES], train[TARGET]' + (tuned ? ', params' : '') + ')');
      L.push('    print(f"\\nHoldout ({len(test):,} rows):")');
      L.push('    resid = evaluate(model, test[FEATURES], test[TARGET].to_numpy(), train[TARGET])');
      L.push('    print("\\nWhat the model leans on:")', '    explain(model, test[FEATURES], test[TARGET].to_numpy())');
      if (ivals && !e.std && !e.quant) {
        L.push('    # split conformal: the COVERAGE-quantile of absolute holdout errors becomes a ± band');
        L.push('    n = len(resid)', '    q = float(np.quantile(np.abs(resid), min(1.0, COVERAGE * (n + 1) / n)))');
        L.push('    print(f"  {COVERAGE:.0%} interval: prediction +/- {q:,.4f}")');
      }
      L.push('', '    final = fit(df[FEATURES], df[TARGET]' + (tuned ? ', params' : '') + ')  # all data for the model you deploy');
      L.push('    joblib.dump({"model": final, "features": FEATURES' + (ivals && !e.std && !e.quant ? ', "conformal_q": q' : '') + (tuned ? ', "params": params' : '') + '}, "model.joblib")');
    }
    L.push('    print("\\nSaved model.joblib. Next: python predict.py new.csv")', '', '');
    L.push('if __name__ == "__main__":', '    main()', '');
    var train = L.join('\n');

    var P = ['"""Predictions for new rows with the model from train.py.', '', '    python predict.py new.csv [predictions.csv]', '',
      'new.csv needs the same columns as ' + spec.file + ' (the target column may be missing).', '"""',
      'import sys', '', 'import joblib', 'import numpy as np', 'import pandas as pd', '',
      'from train import add_features, load' + (clf ? '' : ', predict_rows'), '', '',
      'def main(path, out="predictions.csv"):', '    bundle = joblib.load("model.joblib")', '    df = load(path)', '    X = add_features(df)[bundle["features"]]', '    result = df.copy()'];
    if (clf) {
      P.push('    model, encoder = bundle["model"], bundle["encoder"]');
      P.push('    result["prediction"] = encoder.inverse_transform(np.asarray(model.predict(X)).ravel().astype(int))');
      P.push('    if hasattr(model, "predict_proba"):', '        proba = model.predict_proba(X)', '        for i, label in enumerate(encoder.classes_):', '            result[f"p_{label}"] = proba[:, i]');
    } else {
      P.push('    pred, lo, hi = predict_rows(bundle["model"], X)', '    result["prediction"] = pred');
      if (ivals) {
        if (e.std || e.quant) P.push('    result["lower"], result["upper"] = lo, hi');
        else P.push('    q = bundle["conformal_q"]', '    result["lower"], result["upper"] = pred - q, pred + q');
      }
    }
    P.push('    result.to_csv(out, index=False)', '    print(f"Wrote {len(result):,} predictions to {out}")', '', '',
      'if __name__ == "__main__":', '    if len(sys.argv) < 2:', '        sys.exit("usage: python predict.py new.csv [predictions.csv]")', '    main(*sys.argv[1:3])', '');
    return { train: train, predict: P.join('\n'), requirements: req(m, ['joblib>=1.3', 'scikit-learn>=1.4'], tuned) };
  }

  /* ---------- shared pieces for every forecasting template */
  function fcConfig(spec, d, m, extra) {
    var f = RI.FREQ[spec.freq];
    var L = ['DATA = ' + py(spec.file), 'TARGET = ' + py(d.target), 'TIME = ' + py(d.time),
      'GROUPS = ' + pyList(d.groups, 9) + '  # one series per group; [] = a single series',
      'HORIZON = ' + spec.horizon + '  # ' + f.unit + ' to forecast', 'SEASON = ' + f.season + '  # season length for ' + f.name.toLowerCase() + ' data',
      'FREQ = ' + py(f.alias) + '  # pandas frequency, used when future timestamps have to be generated'];
    return L.concat(extra || []);
  }
  function fcLoad(statics) {
    return ['def load(path):', '    df = pd.read_csv(path)', '    df[TIME] = pd.to_datetime(df[TIME], errors="coerce")', '    df = df.dropna(subset=[TIME])',
      '    if TARGET in df:', '        df[TARGET] = pd.to_numeric(df[TARGET], errors="coerce")',
      '    for c in KNOWN + PAST:', '        if c in df:', '            df[c] = df[c].astype(str).str.strip().str.lower().map(TRUTHY) if c in BOOLEAN else pd.to_numeric(df[c], errors="coerce")',
      '    for c in GROUPS' + (statics ? ' + STATIC' : '') + ':', '        if c in df:', '            df[c] = df[c].fillna("NA").astype(str)',
      '    if not GROUPS:', '        df["_series"] = "all"', '    return df.sort_values(SERIES + [TIME]).reset_index(drop=True)', '', '',
      'def key_of(key):', '    return key if isinstance(key, tuple) else (key,)', '', '',
      'def rows_of(frame, key):', '    """The rows of one series."""', '    mask = np.ones(len(frame), dtype=bool)', '    for c, v in zip(SERIES, key_of(key)):', '        mask &= frame[c].astype(str).to_numpy() == str(v)', '    return frame[mask]', '', '',
      'def make_future(history, future=None):', '    """Rows to forecast: future.csv if you have one (it must hold the known-ahead drivers), otherwise the next',
      '    HORIZON timestamps of every series with the known-ahead drivers held at their last value."""',
      '    if future is not None:', '        return future', '    rows = []', '    for _, s in history.groupby(SERIES, sort=False):',
      '        times = s[TIME].sort_values()', '        freq = (pd.infer_freq(times.tail(12)) if len(times) >= 3 else None) or FREQ',
      '        last = s.iloc[-1]', '        for t in pd.date_range(times.iloc[-1], periods=HORIZON + 1, freq=freq)[1:]:',
      '            row = {c: last[c] for c in SERIES' + (statics ? ' + STATIC' : '') + ' + KNOWN}', '            row[TIME] = t', '            rows.append(row)',
      '    if KNOWN:', '        print(f"note: no future.csv, so {KNOWN} are held at their last value")', '    return pd.DataFrame(rows)', '', '',
      'def seasonal_naive(y, h):', '    """y_{T+k} = y_{T+k-m}: the benchmark. Repeats the last season."""', '    m = SEASON if len(y) >= SEASON else 1', '    return np.asarray(y, dtype=float)[-m:][np.arange(h) % m]', '', '',
      'def scores(y, f, naive, y_train):', '    """MAE, RMSE, sMAPE and MASE (MAE scaled by the in-sample seasonal-naive MAE; < 1 beats it)."""',
      '    m = SEASON if len(y_train) > SEASON else 1', '    scale = np.nanmean(np.abs(np.diff(np.asarray(y_train, dtype=float), n=1) if m == 1 else np.asarray(y_train[m:], float) - np.asarray(y_train[:-m], float)))',
      '    err = y - f', '    return {"mae": np.nanmean(np.abs(err)), "rmse": np.sqrt(np.nanmean(err ** 2)),',
      '            "smape": 200 * np.nanmean(np.abs(err) / np.maximum(np.abs(y) + np.abs(f), 1e-9)),',
      '            "mase": np.nanmean(np.abs(err)) / scale if scale else np.nan, "naive_mae": np.nanmean(np.abs(y - naive))}', '', '',
      'def report(table):', '    t = pd.DataFrame(table)', '    print(f"\\nHoldout: last {HORIZON} periods of {len(t)} series")',
      '    print(f"  MAE    {t.mae.mean():,.4f}   (seasonal naive: {t.naive_mae.mean():,.4f}, skill {1 - t.mae.mean() / t.naive_mae.mean():+.1%})")',
      '    print(f"  RMSE   {t.rmse.mean():,.4f}")', '    print(f"  sMAPE  {t.smape.mean():.2f}%")', '    print(f"  MASE   {t.mase.mean():.3f}   (< 1 beats the naive benchmark)")',
      '    if "coverage" in t:', '        print(f"  interval coverage {t.coverage.mean():.1%} (target {1 - ALPHA:.0%})")', '    return t'];
  }

  /* ---------- template: global ML forecaster with lags (any 'tab' model on the forecast task) */
  function genTabForecast(spec, m, d, title) {
    var e = EST[m.slug], f = RI.FREQ[spec.freq], linear = m.family === 'linear' || m.slug === 'bayesridge' || m.slug === 'mlp';
    var calByFreq = {
      H: [['hour', 't.dt.hour'], ['dow', 't.dt.dayofweek'], ['hour_sin', 'np.sin(2 * np.pi * t.dt.hour / 24)'], ['hour_cos', 'np.cos(2 * np.pi * t.dt.hour / 24)'], ['is_weekend', '(t.dt.dayofweek >= 5).astype(int)']],
      D: [['dow', 't.dt.dayofweek'], ['dom', 't.dt.day'], ['month', 't.dt.month'], ['doy_sin', 'np.sin(2 * np.pi * t.dt.dayofyear / 365.25)'], ['doy_cos', 'np.cos(2 * np.pi * t.dt.dayofyear / 365.25)'], ['is_weekend', '(t.dt.dayofweek >= 5).astype(int)']],
      W: [['woy', 't.dt.isocalendar().week.astype(int)'], ['month', 't.dt.month'], ['woy_sin', 'np.sin(2 * np.pi * t.dt.isocalendar().week.astype(int) / 52.18)'], ['woy_cos', 'np.cos(2 * np.pi * t.dt.isocalendar().week.astype(int) / 52.18)']],
      M: [['month', 't.dt.month'], ['month_sin', 'np.sin(2 * np.pi * t.dt.month / 12)'], ['month_cos', 'np.cos(2 * np.pi * t.dt.month / 12)'], ['quarter', 't.dt.quarter']],
      Q: [['quarter', 't.dt.quarter']], Y: []
    }[spec.freq].concat([['year', 't.dt.year']]);
    if (linear) calByFreq = calByFreq.filter(function (c) { return ['dow', 'dom', 'month', 'hour', 'woy', 'quarter'].indexOf(c[0]) < 0 || spec.freq === 'Q'; });
    calByFreq = calByFreq.map(function (c) { return ['cal_' + c[0], c[1]]; });  // prefixed, so they never overwrite a column called "month"
    var keyKnown = d.keyNum.filter(function (c) { return d.known.indexOf(c) >= 0; }), keyPast = d.keyNum.filter(function (c) { return d.past.indexOf(c) >= 0; });
    var keyCols = keyKnown.map(function (c) { return c + '_delta'; }).concat(keyPast.map(function (c) { return c + '_lag' + (spec.horizon + f.season); }));
    var ivals = spec.intervals, conformal = ivals && !e.std && !e.quant, tuned = spec.tune && RI.tunable(spec, m);
    var L = [];
    L.push(header(spec, m, d, title, ['', 'One global model for every series, on lag and calendar features. It forecasts recursively:',
      'each step\'s prediction becomes the next step\'s lag. Drivers you know in advance are used as-is;',
      'drivers you only learn afterwards are used through lags of at least HORIZON, so nothing leaks from the future.',
      '', 'Run:', '    pip install -r requirements.txt', '    python train.py                         # holdout = last HORIZON periods, then refit -> model.joblib',
      '    python predict.py [history.csv] [future.csv]   # next HORIZON periods -> forecast.csv']));
    L.push('import warnings', '', 'import joblib', 'import numpy as np');
    if (tuned) L.push('import optuna');
    L.push('import pandas as pd');
    if (!e.cat) {
      L.push('from sklearn.compose import ColumnTransformer');
      if (!e.nan) L.push('from sklearn.impute import SimpleImputer');
      L.push('from sklearn.pipeline import Pipeline', 'from sklearn.preprocessing import ' + (e.tree ? 'OrdinalEncoder' : 'OneHotEncoder, StandardScaler'));
    }
    L.push(e.imp.replace(/\b\w+Classifier, /g, ''), '', 'warnings.filterwarnings("ignore")', '');
    L = L.concat(fcConfig(spec, d, m, [
      'KNOWN = ' + pyList(d.known, 8) + '  # known in advance (promos, prices, holidays, weather forecasts): used at time t',
      'PAST = ' + pyList(d.past, 7) + '  # only known afterwards: used as lag >= HORIZON',
      'BOOLEAN = ' + pyList(d.bool, 10),
      'STATIC = ' + pyList(d.cat, 9) + '  # categories, assumed fixed per series or known ahead',
      'KEY_DRIVERS = ' + pyList(d.key, 14) + '  # ★ the columns you highlighted',
      'LAGS = ' + JSON.stringify(f.lags), 'WINDOWS = ' + JSON.stringify(f.wins), 'SERIES = GROUPS or ["_series"]', 'SEED = 42']));
    if (d.txt.length || d.dates.length) L.push('# not used for forecasting: ' + d.txt.concat(d.dates).join(', '));
    if (ivals || e.quant) L.push('ALPHA = 0.1  # 90% intervals');
    if (tuned) L = L.concat(tuneConfig(30, 1200, 3, 'Optuna search scored by a rolling-origin backtest (FOLDS cutoffs, HORIZON apart)'));
    L.push('', 'CALENDAR = ' + pyList(calByFreq.map(function (c) { return c[0]; }), 11));
    L.push('LAG_COLS = [f"lag_{k}" for k in LAGS] + [f"roll_mean_{w}" for w in WINDOWS] + [f"roll_std_{WINDOWS[-1]}"]');
    L.push('PAST_COLS = [f"{c}_lag{HORIZON}" for c in PAST]');
    L.push('KEY_COLS = ' + pyList(keyCols, 11));
    L.push('NUM_FEATURES = LAG_COLS + PAST_COLS + KEY_COLS + KNOWN + CALENDAR');
    L.push('CAT_FEATURES = STATIC + GROUPS');
    L.push('FEATURES = NUM_FEATURES + CAT_FEATURES');
    L.push('', boolParse(), '', '');
    L = L.concat(fcLoad(true));
    L.push('', '');
    L.push('def add_features(df):', '    """Lags, rolling windows and calendar parts. Works on history + future rows (future target = NaN)."""',
      '    df = df.sort_values(SERIES + [TIME]).copy()', '    g = df.groupby(SERIES, sort=False)',
      '    for k in LAGS:', '        df[f"lag_{k}"] = g[TARGET].shift(k)',
      '    for w in WINDOWS:  # shift(1) first: today\'s value never sees itself', '        df[f"roll_mean_{w}"] = g[TARGET].transform(lambda s: s.shift(1).rolling(w, min_periods=1).mean())',
      '    df[f"roll_std_{WINDOWS[-1]}"] = g[TARGET].transform(lambda s: s.shift(1).rolling(WINDOWS[-1], min_periods=2).std())',
      '    for c in PAST:', '        df[f"{c}_lag{HORIZON}"] = g[c].shift(HORIZON)');
    if (keyCols.length) {
      L.push('    # ★ key drivers: their change since last period (known ones) or an extra seasonal lag (past ones)');
      keyKnown.forEach(function (c) { L.push('    df[' + py(c + '_delta') + '] = df[' + py(c) + '] - g[' + py(c) + '].shift(1)'); });
      keyPast.forEach(function (c) { L.push('    df[' + py(c + '_lag' + (spec.horizon + f.season)) + '] = g[' + py(c) + '].shift(' + (spec.horizon + f.season) + ')'); });
    }
    L.push('    t = df[TIME]');
    calByFreq.forEach(function (c) { L.push('    df[' + py(c[0]) + '] = ' + c[1]); });
    L.push('    return df', '', '');
    var est = e.reg;
    if (e.cat) L.push('def make_model():', '    return ' + est, '', '');
    else {
      L.push(e.quant ? 'def make_model(alpha=0.5):' : 'def make_model():');
      if (e.nan) L.push('    numeric = "passthrough"  # early lags are NaN; the trees cope');
      else L.push('    numeric = Pipeline([("impute", SimpleImputer(strategy="median")), ' + (e.tree ? '' : '("scale", StandardScaler())') + '])');
      L.push(e.tree ? '    categorical = OrdinalEncoder(handle_unknown="use_encoded_value", unknown_value=-1' + (m.slug === 'hgb' ? ', max_categories=250' : '') + ')' : '    categorical = OneHotEncoder(handle_unknown="ignore"' + (e.dense ? ', sparse_output=False' : '') + ')');
      L.push('    prep = ColumnTransformer([("num", numeric, NUM_FEATURES), ("cat", categorical, CAT_FEATURES)]' + (e.dense ? ', sparse_threshold=0' : '') + ')');
      L.push('    model = ' + est.replace('categorical_features=CAT_INDEX', 'categorical_features=list(range(len(NUM_FEATURES), len(FEATURES)))').replace(/\n {8}/g, '\n        '));
      L.push('    return Pipeline([("prep", prep), ("model", model)])', '', '');
    }
    if (tuned) L = L.concat(spaceFn(SPACE[m.slug]), WITH_PARAMS);
    L.push('def fit(history' + (tuned ? ', params=None' : '') + '):', '    feats = add_features(history).dropna(subset=[TARGET, "lag_1"])');
    var mk = function (a) { return tuned ? 'with_params(make_model(' + a + '), params or {})' : 'make_model(' + a + ')'; };
    if (e.quant) L.push('    X, y = feats[FEATURES], feats[TARGET]', '    return {name: ' + mk('a') + '.fit(X, y) for name, a in (("lo", ALPHA), ("mid", 0.5), ("hi", 1 - ALPHA))}');
    else L.push('    return ' + mk('') + '.fit(feats[FEATURES], feats[TARGET])');
    L.push('', '');
    L.push('def predict_rows(model, X):');
    if (e.quant) L.push('    mid, lo, hi = (model[q].predict(X) for q in ("mid", "lo", "hi"))', '    return mid, np.minimum(lo, mid), np.maximum(hi, mid)');
    else if (e.std) L.push('    mean, std = model.predict(X, return_std=True)', '    return mean, mean - 1.645 * std, mean + 1.645 * std');
    else L.push('    return model.predict(X), None, None');
    L.push('', '');
    L.push('def recursive_forecast(model, history, future):', '    """Forecast the rows of `future` one time step at a time, feeding each prediction back in as a lag."""',
      '    keep = max(LAGS + WINDOWS) + HORIZON + ' + (f.season + 1),
      '    times = np.sort(history[TIME].unique())', '    history = history[history[TIME] >= times[max(0, len(times) - keep)]]',
      '    frame = pd.concat([history, future.assign(**{TARGET: np.nan})], ignore_index=True)',
      '    frame = frame.sort_values(SERIES + [TIME]).reset_index(drop=True)', '    frame["lo"] = frame["hi"] = np.nan', '    steps = np.sort(future[TIME].unique())',
      '    for t in steps:', '        feats = add_features(frame)', '        rows = (feats[TIME] == t).to_numpy()',
      '        yhat, lo, hi = predict_rows(model, feats.loc[rows, FEATURES])', '        idx = feats.index[rows]', '        frame.loc[idx, TARGET] = yhat',
      '        if lo is not None:', '            frame.loc[idx, "lo"], frame.loc[idx, "hi"] = lo, hi',
      '    return frame[frame[TIME].isin(steps)].rename(columns={TARGET: "forecast"})', '', '');
    if (tuned) {
      L.push('def backtest(params, data):', '    """Rolling origin: for each of FOLDS cutoffs, fit on everything before it and forecast the next HORIZON',
        '    periods recursively, exactly as in production. Returns the mean absolute error over all folds."""',
        '    times = np.sort(data[TIME].unique())', '    errors = []', '    for k in range(FOLDS, 0, -1):',
        '        start = len(times) - k * HORIZON', '        if start <= max(LAGS + WINDOWS):', '            continue  # not enough history before this cutoff',
        '        hist = data[data[TIME] < times[start]]', '        fut = data[(data[TIME] >= times[start]) & (data[TIME] <= times[start + HORIZON - 1])]',
        '        fc = recursive_forecast(fit(hist, params), hist, fut.drop(columns=[TARGET]))',
        '        res = fut.merge(fc[SERIES + [TIME, "forecast"]], on=SERIES + [TIME])', '        errors.append(np.nanmean(np.abs(res[TARGET] - res["forecast"])))',
        '    return float(np.mean(errors)) if errors else float("inf")', '', '',
        'def tune(history):', '    """Optuna on the training history only; the final holdout stays unseen."""', '',
        '    def objective(trial):', '        return backtest(search_space(trial), history)', '');
      L = L.concat(studyLines('minimize', 'backtest MAE'), ['', '']);
    }
    L.push('def main():', '    df = load(DATA).dropna(subset=[TARGET])', '    times = np.sort(df[TIME].unique())',
      '    cutoff = times[-HORIZON]', '    train, test = df[df[TIME] < cutoff], df[df[TIME] >= cutoff]',
      '    print(f"{len(df):,} rows, {df.groupby(SERIES).ngroups} series, holdout from {pd.Timestamp(cutoff).date()}")');
    if (tuned) L.push('    params = {}', '    if TUNE:', '        print(f"\\nTuning ({FOLDS} backtest folds, up to {TUNE_TRIALS} trials):")', '        params = tune(train)');
    L.push('    model = fit(train' + (tuned ? ', params' : '') + ')', '    fc = recursive_forecast(model, train, test.drop(columns=[TARGET]))',
      '    res = test.merge(fc[SERIES + [TIME, "forecast", "lo", "hi"]], on=SERIES + [TIME])', '    table = []',
      '    for key, s in res.groupby(SERIES, sort=False):', '        hist = rows_of(train, key)[TARGET].to_numpy(float)', '        y, f = s[TARGET].to_numpy(float), s["forecast"].to_numpy(float)',
      '        row = scores(y, f, seasonal_naive(hist, len(y)), hist)');
    if (ivals && !conformal) L.push('        row["coverage"] = np.mean((y >= s["lo"]) & (y <= s["hi"]))');
    L.push('        table.append(row)', '    report(table)');
    if (conformal) L.push('    # split conformal: |error| quantile on the holdout becomes the ± band', '    err = np.abs(res[TARGET] - res["forecast"]).dropna()',
      '    q = float(np.quantile(err, min(1.0, (1 - ALPHA) * (len(err) + 1) / len(err))))', '    print(f"  {1 - ALPHA:.0%} interval: forecast +/- {q:,.4f}")');
    L.push('', '    final = fit(df' + (tuned ? ', params' : '') + ')  # refit on everything, including the holdout');
    L.push('    joblib.dump({"model": final' + (conformal ? ', "conformal_q": q' : '') + (tuned ? ', "params": params' : '') + '}, "model.joblib")');
    L.push('    print("\\nSaved model.joblib. Next: python predict.py")', '', '', 'if __name__ == "__main__":', '    main()', '');
    var P = ['"""Forecast the next HORIZON periods of every series.', '', '    python predict.py [history.csv] [future.csv]', '',
      'history.csv  recent rows in the training format (default: ' + spec.file + '); at least ' + (Math.max.apply(null, f.lags.concat(f.wins)) + 1) + ' periods per series.',
      'future.csv   optional: the forecast rows with ' + [d.time].concat(d.groups, d.known, d.cat).join(', ') + '.', '"""',
      'import sys', '', 'import joblib', 'import numpy as np', 'import pandas as pd', '',
      'from train import DATA, GROUPS, SERIES, TIME, load, make_future, recursive_forecast', '', '',
      'def main(history_path=DATA, future_path=None, out="forecast.csv"):', '    bundle = joblib.load("model.joblib")', '    history = load(history_path)',
      '    future = make_future(history, load(future_path) if future_path else None)', '    fc = recursive_forecast(bundle["model"], history, future)',
      '    cols = SERIES + [TIME, "forecast"]' + (ivals ? ' + ["lo", "hi"]' : '')];
    if (conformal) P.push('    q = bundle["conformal_q"]', '    fc["lo"], fc["hi"] = fc["forecast"] - q, fc["forecast"] + q');
    P.push('    result = fc[cols] if GROUPS else fc[cols].drop(columns=["_series"])', '    result.to_csv(out, index=False)',
      '    print(f"Wrote {len(result):,} forecasts to {out}")', '', '', 'if __name__ == "__main__":', '    main(*sys.argv[1:3])', '');
    return { train: L.join('\n'), predict: P.join('\n'), requirements: req(m, ['joblib>=1.3', 'scikit-learn>=1.4'], tuned) };
  }

  /* ---------- templates: classical per-series models (refit at forecast time) */
  var FIT = {
    naive: { imp: [], params: '{}', body: ['    y = hist[TARGET].to_numpy(float)', '    h = len(fut)', '    yhat = seasonal_naive(y, h)',
      '    m = SEASON if len(y) > SEASON else 1', '    e = y[m:] - y[:-m]  # in-sample seasonal-naive errors',
      '    q = np.nanquantile(np.abs(e), 1 - ALPHA) if len(e) else np.nan', '    width = q * np.sqrt(np.arange(h) // m + 1)  # wider each season further out',
      '    return yhat, yhat - width, yhat + width'] },
    arima: { imp: ['from statsmodels.tsa.statespace.sarimax import SARIMAX'], params: '{"order": (1, 1, 1), "seasonal": True}  # (p,d,q) and a (1,1,1)m seasonal part', body: [
      '    p = dict(PARAMS, **(params or {}))', '    y = hist[TARGET].to_numpy(float)', '    X = hist[KNOWN].ffill().fillna(0).to_numpy(float) if KNOWN else None',
      '    Xf = fut[KNOWN].ffill().fillna(0).to_numpy(float) if KNOWN else None',
      '    seasonal = (1, 1, 1, SEASON) if p["seasonal"] and SEASON > 1 and len(y) >= 3 * SEASON else (0, 0, 0, 0)',
      '    res = SARIMAX(y, exog=X, order=tuple(p["order"]), seasonal_order=seasonal,', '                  enforce_stationarity=False, enforce_invertibility=False).fit(disp=False)',
      '    fc = res.get_forecast(steps=len(fut), exog=Xf)', '    ci = np.asarray(fc.conf_int(alpha=ALPHA))', '    return np.asarray(fc.predicted_mean), ci[:, 0], ci[:, 1]'] },
    ets: { imp: ['from statsmodels.tsa.exponential_smoothing.ets import ETSModel'], params: '{"trend": "add", "damped": True, "seasonal": "add"}', body: [
      '    p = dict(PARAMS, **(params or {}))', '    y = pd.Series(hist[TARGET].to_numpy(float)).interpolate().bfill()  # a Series: ETS predictions need an index',
      '    seasonal = p["seasonal"] if SEASON > 1 and len(y) >= 2 * SEASON else None',
      '    if seasonal == "mul" and y.min() <= 0:', '        seasonal = "add"  # multiplicative seasonality needs positive values',
      '    res = ETSModel(y, error="add", trend=p["trend"], damped_trend=bool(p["damped"] and p["trend"]), seasonal=seasonal,', '                   seasonal_periods=SEASON if seasonal else None).fit(disp=False)',
      '    sf = res.get_prediction(start=len(y), end=len(y) + len(fut) - 1).summary_frame(alpha=ALPHA)',
      '    return sf["mean"].to_numpy(), sf["pi_lower"].to_numpy(), sf["pi_upper"].to_numpy()'] },
    theta: { imp: ['from statsmodels.tsa.forecasting.theta import ThetaModel'], params: '{"theta": 2.0}  # 2 = the classic Theta method', body: [
      '    p = dict(PARAMS, **(params or {}))', '    y = pd.Series(hist[TARGET].to_numpy(float)).interpolate().bfill().to_numpy()',
      '    period = SEASON if SEASON > 1 and len(y) >= 2 * SEASON else 1',
      '    res = ThetaModel(y, period=period, deseasonalize=period > 1).fit()', '    h = len(fut)',
      '    pi = res.prediction_intervals(h, theta=p["theta"], alpha=ALPHA)', '    return np.asarray(res.forecast(h, theta=p["theta"])), pi["lower"].to_numpy(), pi["upper"].to_numpy()'] },
    prophet: { imp: ['import logging', '', 'from prophet import Prophet', '', 'logging.getLogger("cmdstanpy").setLevel(logging.WARNING)'],
      params: '{"changepoint_prior_scale": 0.05, "seasonality_prior_scale": 10.0, "seasonality_mode": "additive"}', body: [
      '    p = dict(PARAMS, **(params or {}))', '    d = pd.DataFrame({"ds": hist[TIME].to_numpy(), "y": hist[TARGET].to_numpy(float)})',
      '    model = Prophet(interval_width=1 - ALPHA, daily_seasonality=FREQ == "h", **p)',
      '    for c in KNOWN:  # known-ahead drivers become extra regressors', '        model.add_regressor(c)', '        d[c] = hist[c].ffill().fillna(0).to_numpy(float)',
      '    model.fit(d)', '    f = pd.DataFrame({"ds": fut[TIME].to_numpy()})', '    for c in KNOWN:', '        f[c] = fut[c].ffill().fillna(0).to_numpy(float)',
      '    pr = model.predict(f)', '    return pr["yhat"].to_numpy(), pr["yhat_lower"].to_numpy(), pr["yhat_upper"].to_numpy()'] },
    var: { imp: ['from statsmodels.tsa.api import VAR'], params: '{"maxlags": None}  # None = choose by AIC, up to one season', body: [
      '    p = dict(PARAMS, **(params or {}))', '    data = hist[[TARGET] + OTHERS].astype(float).interpolate().bfill()',
      '    diff = data.diff().dropna()  # VAR wants stationary inputs, so it models the changes',
      '    maxlags = max(1, min(p["maxlags"] or SEASON, len(diff) // 10))', '    res = VAR(diff.to_numpy()).fit(maxlags=maxlags, ic=None if p["maxlags"] else "aic")',
      '    if res.k_ar == 0:', '        res = VAR(diff.to_numpy()).fit(1)',
      '    mean, lo, hi = res.forecast_interval(diff.to_numpy()[-res.k_ar:], steps=len(fut), alpha=ALPHA)',
      '    yhat = data[TARGET].iloc[-1] + np.cumsum(mean[:, 0])  # undo the differencing',
      '    half = np.sqrt(np.cumsum(((hi[:, 0] - lo[:, 0]) / 2) ** 2))  # widths add in quadrature (independent steps)',
      '    return yhat, yhat - half, yhat + half'] }
  };
  function genStat(spec, m, d, title) {
    var F = FIT[m.slug] || FIT.naive, others = d.num.concat(d.bool);
    var usesKnown = m.slug === 'arima' || m.slug === 'prophet', tuned = spec.tune && RI.tunable(spec, m);
    var L = [header(spec, m, d, title, ['', 'One model per series. Classical models are cheap to fit, so predict.py refits on the latest', 'history every time you forecast: no stale model file to manage.', '',
      'Run:', '    pip install -r requirements.txt', '    python train.py                         # ' + (tuned ? 'tunes by backtest (-> params.json), then ' : '') + 'scores the last HORIZON periods of every series',
      '    python predict.py [history.csv] [future.csv]   # refit + forecast -> forecast.csv'])];
    L.push('import ' + (tuned ? 'json' : 'warnings'));
    if (tuned) L.push('import warnings');
    L.push('', 'import numpy as np');
    if (tuned) L.push('import optuna');
    L.push('import pandas as pd');
    if (F.imp.length) L.push(F.imp.join('\n'));
    L.push('', 'warnings.filterwarnings("ignore")', '');
    L = L.concat(fcConfig(spec, d, m, [
      'KNOWN = ' + (usesKnown ? pyList(d.known, 8) + '  # known-ahead drivers: exogenous regressors' : '[]  # ' + m.name + ' is univariate' + (d.known.length ? ': ' + d.known.join(', ') + ' not used' : '')),
      'PAST = []', 'BOOLEAN = ' + pyList(d.bool.filter(function (b) { return usesKnown && d.known.indexOf(b) >= 0 || m.slug === 'var'; }), 10),
      m.slug === 'var' ? 'OTHERS = ' + pyList(others, 9) + '  # modelled jointly with the target' : null,
      'SERIES = GROUPS or ["_series"]', 'ALPHA = 0.1  # 90% intervals', 'PARAMS = ' + F.params + (tuned ? '' : '')].filter(Boolean)));
    if (tuned) L = L.concat(['SEED = 42'], tuneConfig(25, 1200, 3, 'Optuna search scored by a rolling-origin backtest (mean MASE)'));
    L.push('', boolParse(), '', '');
    L = L.concat(fcLoad(false).map(function (l) { return m.slug === 'var' ? l.replace('for c in KNOWN + PAST:', 'for c in KNOWN + PAST + OTHERS:') : l; }));
    L.push('', '', 'def fit_forecast(hist, fut, params=None):', '    """Fit ' + m.name + ' on one series\' history and forecast the rows of `fut`. Returns (yhat, lo, hi)."""');
    L = L.concat(F.body);
    if (tuned) {
      L.push('', '');
      L = L.concat(spaceFn(SPACE[m.slug]));
      L.push('def backtest(params, df):', '    """Mean MASE over FOLDS rolling origins per series. The last HORIZON periods (the final holdout) are left out."""',
        '    errors = []', '    for _, s in df.groupby(SERIES, sort=False):', '        s = s.dropna(subset=[TARGET]).iloc[:-HORIZON]', '        for k in range(FOLDS, 0, -1):',
        '            end = len(s) - (k - 1) * HORIZON', '            hist, test = s.iloc[:end - HORIZON], s.iloc[end - HORIZON:end]',
        '            if len(hist) <= max(2 * SEASON, 8):', '                continue', '            yhat, _, _ = fit_forecast(hist, test, params)',
        '            y, h = test[TARGET].to_numpy(float), hist[TARGET].to_numpy(float)',
        '            errors.append(scores(y, np.asarray(yhat, float), seasonal_naive(h, len(y)), h)["mase"])',
        '    return float(np.nanmean(errors)) if errors else float("inf")', '', '',
        'def tune(df):', '    """Optuna over the settings above; the best ones go to params.json for predict.py."""', '',
        '    def objective(trial):', '        try:', '            return backtest(search_space(trial), df)', '        except Exception:  # e.g. an order that will not fit', '            return float("inf")', '');
      L = L.concat(studyLines('minimize', 'backtest MASE').slice(0, -1), ['    with open("params.json", "w") as fh:', '        json.dump(best, fh)', '    return best']);
    }
    L.push('', '', 'def main():', '    df = load(DATA)');
    if (tuned) L.push('    params = PARAMS', '    if TUNE:', '        print(f"Tuning ({FOLDS} backtest folds per series, up to {TUNE_TRIALS} trials):")', '        params = tune(df)');
    L.push('    table, skipped = [], 0', '    for key, s in df.groupby(SERIES, sort=False):',
      '        s = s.dropna(subset=[TARGET]) if s[TARGET].notna().sum() > HORIZON else s', '        if len(s) <= HORIZON + max(2 * SEASON, 8):', '            skipped += 1', '            continue',
      '        hist, test = s.iloc[:-HORIZON], s.iloc[-HORIZON:]', '        yhat, lo, hi = fit_forecast(hist, test' + (tuned ? ', params' : '') + ')', '        y, h = test[TARGET].to_numpy(float), hist[TARGET].to_numpy(float)',
      '        row = scores(y, np.asarray(yhat, float), seasonal_naive(h, len(y)), h)', '        row["coverage"] = np.mean((y >= lo) & (y <= hi))', '        table.append(row)',
      '    if skipped:', '        print(f"skipped {skipped} series that are too short to score")', '    if not table:', '        raise SystemExit("No series is long enough: lower HORIZON or add history.")',
      '    report(table).to_csv("evaluation.csv", index=False)', '    print("\\nPer-series scores in evaluation.csv. Next: python predict.py")', '', '',
      'if __name__ == "__main__":', '    main()', '');
    var P = ['"""Refit on the latest history and forecast the next HORIZON periods of every series.', '', '    python predict.py [history.csv] [future.csv]', '',
      usesKnown && d.known.length ? 'future.csv: optional rows for the forecast period with ' + [d.time].concat(d.groups, d.known).join(', ') + '.' : 'future.csv: optional; by default the next HORIZON timestamps are generated.', '"""',
      'import sys'].concat(tuned ? ['import json', 'import os'] : []).concat(['', 'import numpy as np', 'import pandas as pd', '', 'from train import DATA, GROUPS, PARAMS, SERIES, TARGET, TIME, fit_forecast, load, make_future, rows_of', '', '',
      'def main(history_path=DATA, future_path=None, out="forecast.csv"):', '    history = load(history_path)']);
    if (tuned) P.push('    params = PARAMS', '    if os.path.exists("params.json"):  # written by the tuning in train.py', '        with open("params.json") as fh:', '            params = json.load(fh)');
    P.push('    future = make_future(history, load(future_path) if future_path else None)', '    parts = []',
      '    for key, s in history.groupby(SERIES, sort=False):', '        fut = rows_of(future, key).sort_values(TIME)', '        yhat, lo, hi = fit_forecast(s.dropna(subset=[TARGET]), fut' + (tuned ? ', params' : '') + ')',
      '        parts.append(fut[SERIES + [TIME]].assign(forecast=yhat, lo=lo, hi=hi))', '    result = pd.concat(parts, ignore_index=True)',
      '    if not GROUPS:', '        result = result.drop(columns=["_series"])', '    result.to_csv(out, index=False)', '    print(f"Wrote {len(result):,} forecasts to {out}")', '', '',
      'if __name__ == "__main__":', '    main(*sys.argv[1:3])', '');
    return { train: L.join('\n'), predict: P.join('\n'), requirements: req(m, null, tuned) };
  }

  /* ---------- template: PyTorch sequence models. Net(n_in, n_fut, hidden) maps (past window, known future) -> HORIZON values
     (or HORIZON x QUANTILES for the nets in QNETS). */
  var HEAD = '        self.head = nn.Sequential(nn.Linear(hidden + n_fut * HORIZON, hidden), nn.ReLU(), nn.Linear(hidden, HORIZON))';
  var NETS = {
    lstm: ['class Net(nn.Module):', '    """LSTM encoder over the lookback window + an MLP head that also sees the known future."""',
      '    def __init__(self, n_in, n_fut, hidden=HIDDEN):', '        super().__init__()', '        self.rnn = nn.LSTM(n_in, hidden, num_layers=2, batch_first=True, dropout=0.1)', HEAD, '',
      '    def forward(self, x, xf):', '        out, _ = self.rnn(x)', '        return self.head(torch.cat([out[:, -1], xf.flatten(1)], dim=1))'],
    gru: ['class Net(nn.Module):', '    """GRU encoder over the lookback window + an MLP head that also sees the known future."""',
      '    def __init__(self, n_in, n_fut, hidden=HIDDEN):', '        super().__init__()', '        self.rnn = nn.GRU(n_in, hidden, num_layers=2, batch_first=True, dropout=0.1)', HEAD, '',
      '    def forward(self, x, xf):', '        out, _ = self.rnn(x)', '        return self.head(torch.cat([out[:, -1], xf.flatten(1)], dim=1))'],
    tcn: ['class CausalBlock(nn.Module):', '    """Two dilated causal convolutions with a residual connection (pad on the left only: no peeking)."""',
      '    def __init__(self, c_in, c_out, k, dilation):', '        super().__init__()', '        self.pad = (k - 1) * dilation',
      '        self.conv1 = nn.Conv1d(c_in, c_out, k, dilation=dilation)', '        self.conv2 = nn.Conv1d(c_out, c_out, k, dilation=dilation)',
      '        self.skip = nn.Conv1d(c_in, c_out, 1) if c_in != c_out else nn.Identity()', '        self.drop = nn.Dropout(0.1)', '',
      '    def forward(self, x):', '        h = self.drop(torch.relu(self.conv1(nn.functional.pad(x, (self.pad, 0)))))',
      '        h = self.drop(torch.relu(self.conv2(nn.functional.pad(h, (self.pad, 0)))))', '        return torch.relu(h + self.skip(x))', '', '',
      'class Net(nn.Module):', '    """TCN: receptive field = 1 + 2 * (k - 1) * (2**LEVELS - 1) steps."""', '    LEVELS = 5', '',
      '    def __init__(self, n_in, n_fut, hidden=HIDDEN):', '        super().__init__()',
      '        self.tcn = nn.Sequential(*[CausalBlock(n_in if i == 0 else hidden, hidden, 3, 2 ** i) for i in range(self.LEVELS)])', HEAD, '',
      '    def forward(self, x, xf):', '        h = self.tcn(x.transpose(1, 2))[:, :, -1]', '        return self.head(torch.cat([h, xf.flatten(1)], dim=1))'],
    transformer: ['class Net(nn.Module):', '    """Transformer encoder with learned positions; the last token summarises the window."""',
      '    def __init__(self, n_in, n_fut, hidden=HIDDEN):', '        super().__init__()', '        self.inp = nn.Linear(n_in, hidden)', '        self.pos = nn.Parameter(torch.zeros(1, LOOKBACK, hidden))',
      '        layer = nn.TransformerEncoderLayer(hidden, nhead=4, dim_feedforward=2 * hidden, dropout=0.1, batch_first=True)',
      '        self.enc = nn.TransformerEncoder(layer, num_layers=2)', HEAD, '',
      '    def forward(self, x, xf):', '        h = self.enc(self.inp(x) + self.pos[:, -x.shape[1]:])[:, -1]', '        return self.head(torch.cat([h, xf.flatten(1)], dim=1))'],
    nbeats: ['class Block(nn.Module):', '    """One N-BEATS block: four fully connected layers, then a backcast (what it explains) and a partial forecast."""',
      '    def __init__(self, n_ctx, width):', '        super().__init__()',
      '        layers = []', '        for i in range(4):', '            layers += [nn.Linear(LOOKBACK + n_ctx if i == 0 else width, width), nn.ReLU()]',
      '        self.fc = nn.Sequential(*layers)', '        self.back = nn.Linear(width, LOOKBACK)', '        self.fore = nn.Linear(width, HORIZON)', '',
      '    def forward(self, x, ctx):', '        h = self.fc(torch.cat([x, ctx], dim=1))', '        return self.back(h), self.fore(h)', '', '',
      'class Net(nn.Module):', '    """N-BEATS with generic blocks, doubly residual. The target window is the residual stream; past drivers,',
      '    calendar and the known future enter every block as extra context (the NBEATSx idea)."""', '    BLOCKS = 6', '',
      '    def __init__(self, n_in, n_fut, hidden=HIDDEN):', '        super().__init__()', '        n_ctx = (n_in - 1) * LOOKBACK + n_fut * HORIZON',
      '        self.blocks = nn.ModuleList([Block(n_ctx, 4 * hidden) for _ in range(self.BLOCKS)])', '',
      '    def forward(self, x, xf):', '        resid = x[:, :, 0]  # the scaled target window', '        ctx = torch.cat([x[:, :, 1:].flatten(1), xf.flatten(1)], dim=1)',
      '        out = 0', '        for block in self.blocks:', '            back, fore = block(resid, ctx)', '            resid = resid - back  # the next block sees what is still unexplained',
      '            out = out + fore', '        return out'],
    tft: ['class GRN(nn.Module):', '    """Gated residual network: LayerNorm(skip(a) + GLU(W1 ELU(W2 a)))."""',
      '    def __init__(self, d_in, d, d_out=None):', '        super().__init__()', '        d_out = d_out or d',
      '        self.skip = nn.Linear(d_in, d_out) if d_in != d_out else nn.Identity()', '        self.fc1, self.fc2 = nn.Linear(d_in, d), nn.Linear(d, 2 * d_out)',
      '        self.drop, self.norm = nn.Dropout(0.1), nn.LayerNorm(d_out)', '',
      '    def forward(self, a):', '        h = self.fc2(self.drop(nn.functional.elu(self.fc1(a))))', '        return self.norm(self.skip(a) + nn.functional.glu(h, dim=-1))', '', '',
      'class VariableSelection(nn.Module):', '    """Embeds every input variable, weighs them with a softmax computed from all of them (the weights are',
      '    variable importances), and returns the weighted sum."""',
      '    def __init__(self, n_vars, d):', '        super().__init__()', '        self.embed = nn.ModuleList([nn.Linear(1, d) for _ in range(n_vars)])',
      '        self.weights = GRN(n_vars * d, d, n_vars)', '        self.vars = nn.ModuleList([GRN(d, d) for _ in range(n_vars)])', '',
      '    def forward(self, x):', '        e = [emb(x[..., i:i + 1]) for i, emb in enumerate(self.embed)]',
      '        w = torch.softmax(self.weights(torch.cat(e, dim=-1)), dim=-1)', '        v = torch.stack([g(ei) for g, ei in zip(self.vars, e)], dim=-1)',
      '        return (v * w.unsqueeze(-2)).sum(-1), w', '', '',
      'class InterpretableAttention(nn.Module):', '    """Multi-head attention whose heads share one value projection, so the averaged weights stay readable."""',
      '    def __init__(self, d, heads=4):', '        super().__init__()', '        dk = max(d // heads, 1)',
      '        self.q = nn.ModuleList([nn.Linear(d, dk) for _ in range(heads)])', '        self.k = nn.ModuleList([nn.Linear(d, dk) for _ in range(heads)])',
      '        self.v, self.out, self.scale = nn.Linear(d, d), nn.Linear(d, d), dk ** -0.5', '',
      '    def forward(self, x, mask):', '        att = torch.stack([torch.softmax(q(x) @ k(x).transpose(1, 2) * self.scale + mask, dim=-1)',
      '                           for q, k in zip(self.q, self.k)]).mean(0)', '        return self.out(att @ self.v(x)), att', '', '',
      'class Net(nn.Module):', '    """A compact Temporal Fusion Transformer (Lim et al., 2021): variable selection, an LSTM encoder-decoder,',
      '    interpretable attention and quantile outputs. (Static covariates are left out in this listing.)"""', '',
      '    def __init__(self, n_in, n_fut, hidden=HIDDEN):', '        super().__init__()',
      '        self.sel_past, self.sel_fut = VariableSelection(n_in, hidden), VariableSelection(max(n_fut, 1), hidden)',
      '        self.enc = nn.LSTM(hidden, hidden, batch_first=True)', '        self.dec = nn.LSTM(hidden, hidden, batch_first=True)',
      '        self.gate1, self.norm1 = nn.Linear(hidden, 2 * hidden), nn.LayerNorm(hidden)', '        self.enrich = GRN(hidden, hidden)',
      '        self.attn = InterpretableAttention(hidden)', '        self.gate2, self.norm2 = nn.Linear(hidden, 2 * hidden), nn.LayerNorm(hidden)',
      '        self.ff = GRN(hidden, hidden)', '        self.gate3, self.norm3 = nn.Linear(hidden, 2 * hidden), nn.LayerNorm(hidden)',
      '        self.head = nn.Linear(hidden, len(QUANTILES))', '',
      '    def forward(self, x, xf):', '        if xf.shape[-1] == 0:  # nothing known ahead: the decoder reads a constant',
      '            xf = torch.zeros(*xf.shape[:2], 1, device=x.device)', '        past, _ = self.sel_past(x)', '        fut, _ = self.sel_fut(xf)',
      '        h_enc, state = self.enc(past)', '        h_dec, _ = self.dec(fut, state)', '        glu = nn.functional.glu',
      '        h = self.norm1(torch.cat([past, fut], dim=1) + glu(self.gate1(torch.cat([h_enc, h_dec], dim=1)), dim=-1))',
      '        e = self.enrich(h)', '        n = e.shape[1]', '        mask = torch.triu(torch.full((n, n), float("-inf"), device=x.device), 1)  # causal: no looking ahead',
      '        a, _ = self.attn(e, mask)', '        h2 = self.norm2(e + glu(self.gate2(a), dim=-1))',
      '        out = self.norm3(h + glu(self.gate3(self.ff(h2)), dim=-1))', '        return self.head(out[:, -xf.shape[1]:])  # (batch, HORIZON, quantiles)']
  };
  var QNETS = { tft: true };
  function genTorch(spec, m, d, title) {
    var f = RI.FREQ[spec.freq], quant = !!QNETS[m.slug], tuned = spec.tune && RI.tunable(spec, m);
    var cal = { H: ['np.sin(2 * np.pi * t.dt.hour / 24)', 'np.cos(2 * np.pi * t.dt.hour / 24)', 'np.sin(2 * np.pi * t.dt.dayofweek / 7)', 'np.cos(2 * np.pi * t.dt.dayofweek / 7)'],
      D: ['np.sin(2 * np.pi * t.dt.dayofweek / 7)', 'np.cos(2 * np.pi * t.dt.dayofweek / 7)', 'np.sin(2 * np.pi * t.dt.dayofyear / 365.25)', 'np.cos(2 * np.pi * t.dt.dayofyear / 365.25)'],
      W: ['np.sin(2 * np.pi * t.dt.isocalendar().week.astype(int) / 52.18)', 'np.cos(2 * np.pi * t.dt.isocalendar().week.astype(int) / 52.18)'],
      M: ['np.sin(2 * np.pi * t.dt.month / 12)', 'np.cos(2 * np.pi * t.dt.month / 12)'], Q: ['np.sin(2 * np.pi * t.dt.quarter / 4)', 'np.cos(2 * np.pi * t.dt.quarter / 4)'], Y: [] }[spec.freq];
    var L = [header(spec, m, d, title, ['', 'A global sequence model: it reads the last LOOKBACK steps of every series (target, drivers, calendar)',
      'and outputs all HORIZON future values at once' + (quant ? ' (three quantiles each)' : '') + ', also seeing the known-ahead drivers for those steps.', '',
      'Run:', '    pip install -r requirements.txt', '    python train.py                         # ' + (tuned ? 'tunes, ' : '') + 'trains, scores the last HORIZON periods, saves model.pt + model.joblib',
      '    python predict.py [history.csv] [future.csv]   # next HORIZON periods -> forecast.csv', '', 'A GPU helps a lot; on CPU, lower EPOCHS or HIDDEN first.'])];
    L.push('import copy', 'import warnings', '', 'import joblib', 'import numpy as np');
    if (tuned) L.push('import optuna');
    L.push('import pandas as pd', 'import torch', 'from numpy.lib.stride_tricks import sliding_window_view', 'from torch import nn', '', 'warnings.filterwarnings("ignore")', '');
    L = L.concat(fcConfig(spec, d, m, [
      'KNOWN = ' + pyList(d.known, 8) + '  # known in advance: fed for the past AND the forecast steps',
      'PAST = ' + pyList(d.past, 7) + '  # only known afterwards: fed for the past steps only',
      'BOOLEAN = ' + pyList(d.bool, 10), 'SERIES = GROUPS or ["_series"]',
      'LOOKBACK = ' + f.look + '  # steps the network reads (' + Math.round(f.look / Math.max(f.season, 1)) + ' seasons)',
      'HIDDEN = 64', 'EPOCHS = 40', 'BATCH = 256', 'LR = 1e-3', 'PATIENCE = 6  # early stopping',
      quant ? 'QUANTILES = [0.1, 0.5, 0.9]  # the network outputs these quantiles of every future step (an 80% band)' : 'ALPHA = 0.1  # 90% conformal intervals',
      'REFIT = True  # retrain on all data after scoring (doubles the time; set False to keep the scored model)',
      'SEED = 42', 'DEVICE = "cuda" if torch.cuda.is_available() else "cpu"']));
    if (quant) L.push('ALPHA = 0.2  # for the coverage report: the P10-P90 band should hold about 80%');
    if (tuned) L = L.concat(tuneConfig(12, 3600, 0, 'Optuna over the network size and learning rate first'), ['TUNE_EPOCHS = 12  # shorter training per trial']);
    if (d.cat.length || d.txt.length) L.push('# not used by the network: ' + d.cat.concat(d.txt).join(', ') + ' (add embeddings if they matter)');
    L.push('', boolParse(), '', '');
    L = L.concat(fcLoad(false));
    L.push('', '', 'def calendar(t):', '    """Cyclic calendar features (sin/cos), no scaling needed."""');
    if (cal.length) L.push('    t = pd.Series(pd.to_datetime(t)).reset_index(drop=True)', '    return np.column_stack([', '        ' + cal.join(',\n        ') + ',', '    ]).astype(np.float32)');
    else L.push('    return np.zeros((len(t), 0), dtype=np.float32)');
    L.push('', '', 'def fit_scaler(df):', '    """Mean/sd for the drivers, from training rows only."""',
      '    sc = {}', '    for name, cols in (("known", KNOWN), ("past", PAST)):', '        x = df[cols].to_numpy(float) if cols else np.zeros((len(df), 0))',
      '        sc[name] = (np.nanmean(x, 0) if cols else x[:0].sum(0), (np.nanstd(x, 0) + 1e-6) if cols else x[:0].sum(0))', '    return sc', '', '',
      'def arrays(s, sc, stats):', '    """One series -> (past inputs per step, future inputs per step, scaled target)."""', '    mu, sd = stats',
      '    y = ((s[TARGET].to_numpy(float) if TARGET in s else np.full(len(s), np.nan)) - mu) / sd',
      '    known = (s.reindex(columns=KNOWN).to_numpy(float) - sc["known"][0]) / sc["known"][1] if KNOWN else np.zeros((len(s), 0))',
      '    past = (s.reindex(columns=PAST).to_numpy(float) - sc["past"][0]) / sc["past"][1] if PAST else np.zeros((len(s), 0))  # future rows: NaN -> 0',
      '    cal = calendar(s[TIME])', '    xp = np.nan_to_num(np.column_stack([np.nan_to_num(y)[:, None], past, known, cal])).astype(np.float32)',
      '    xf = np.nan_to_num(np.column_stack([known, cal])).astype(np.float32).reshape(len(s), -1)', '    return xp, xf, y.astype(np.float32)', '', '',
      'def series_stats(df):', '    return {key_of(k): (float(np.nanmean(s[TARGET])), float(np.nanstd(s[TARGET]) or 1.0)) for k, s in df.groupby(SERIES, sort=False)}', '', '',
      'def build(df, sc, stats):', '    """All training windows: LOOKBACK steps in, HORIZON steps out."""', '    X, F, Y, E = [], [], [], []',
      '    for key, s in df.groupby(SERIES, sort=False):', '        xp, xf, y = arrays(s, sc, stats[key_of(key)])', '        n = len(s) - LOOKBACK - HORIZON + 1',
      '        if n <= 0:', '            continue', '        X.append(sliding_window_view(xp, LOOKBACK, axis=0)[:n].transpose(0, 2, 1))',
      '        F.append(sliding_window_view(xf, HORIZON, axis=0)[LOOKBACK:LOOKBACK + n].transpose(0, 2, 1))',
      '        Y.append(sliding_window_view(y, HORIZON)[LOOKBACK:LOOKBACK + n])', '        E.append(s[TIME].to_numpy()[LOOKBACK:LOOKBACK + n])',
      '    if not X:', '        raise SystemExit(f"Series are too short: need at least LOOKBACK + HORIZON = {LOOKBACK + HORIZON} rows.")',
      '    X, F, Y, E = (np.concatenate(a) for a in (X, F, Y, E))', '    ok = ~np.isnan(Y).any(1)', '    return X[ok], F[ok], Y[ok], E[ok]', '', '');
    L = L.concat(NETS[m.slug]);
    L.push('', '');
    if (quant) L.push('def pinball(pred, y):', '    """Quantile (pinball) loss averaged over QUANTILES. pred: (batch, h, q), y: (batch, h)."""',
      '    q = torch.tensor(QUANTILES, device=pred.device)', '    e = y.unsqueeze(-1) - pred', '    return torch.maximum(q * e, (q - 1) * e).mean()', '', '');
    L.push('def batches(n, size, shuffle):', '    idx = np.random.permutation(n) if shuffle else np.arange(n)', '    for b in range(0, n, size):', '        yield torch.from_numpy(idx[b:b + size])', '', '',
      'def train_net(X, F, Y, E, hidden=HIDDEN, lr=LR, epochs=EPOCHS, verbose=True):', '    """AdamW + ' + (quant ? 'pinball' : 'Huber') + ' loss; the latest 10% of windows (by time) is the early-stopping set."""',
      '    torch.manual_seed(SEED)', '    np.random.seed(SEED)', '    order = np.argsort(E, kind="stable")', '    cut = int(len(order) * 0.9)', '    tr, va = order[:cut], order[cut:]',
      '    if len(va) == 0:', '        va = tr[-1:]',
      '    X, F, Y = (torch.from_numpy(np.ascontiguousarray(a)) for a in (X, F, Y))',
      '    net = Net(X.shape[2], F.shape[2], hidden).to(DEVICE)', '    opt = torch.optim.AdamW(net.parameters(), lr=lr, weight_decay=1e-4)', '    loss_fn = ' + (quant ? 'pinball' : 'nn.HuberLoss()'),
      '    best, best_state, bad = float("inf"), None, 0', '    for epoch in range(epochs):', '        net.train()',
      '        for j in batches(len(tr), BATCH, True):', '            j = torch.from_numpy(tr)[j]', '            opt.zero_grad()',
      '            loss = loss_fn(net(X[j].to(DEVICE), F[j].to(DEVICE)), Y[j].to(DEVICE))', '            loss.backward()',
      '            nn.utils.clip_grad_norm_(net.parameters(), 1.0)', '            opt.step()', '        net.eval()', '        with torch.no_grad():',
      '            v = np.mean([loss_fn(net(X[torch.from_numpy(va)[j]].to(DEVICE), F[torch.from_numpy(va)[j]].to(DEVICE)),',
      '                                 Y[torch.from_numpy(va)[j]].to(DEVICE)).item() for j in batches(len(va), 1024, False)])',
      '        if verbose:', '            print(f"  epoch {epoch + 1:3d}   validation loss {v:.5f}")', '        if v < best - 1e-5:', '            best, best_state, bad = v, copy.deepcopy(net.state_dict()), 0',
      '        else:', '            bad += 1', '            if bad >= PATIENCE:', '                break', '    net.load_state_dict(best_state)', '    net.best_val = best', '    return net.eval()', '', '');
    if (tuned) {
      L = L.concat(spaceFn(SPACE.torch));
      L.push('def tune(train):', '    """Optuna on the training windows only: each trial trains TUNE_EPOCHS epochs and is scored on the latest',
        '    10% of windows (by time). The final holdout stays unseen."""', '    sc, stats = fit_scaler(train), series_stats(train)', '    X, F, Y, E = build(train, sc, stats)', '',
        '    def objective(trial):', '        return train_net(X, F, Y, E, epochs=TUNE_EPOCHS, verbose=False, **search_space(trial)).best_val', '');
      L = L.concat(studyLines('minimize', 'validation loss'), ['', '']);
    }
    L.push('def forecast_series(net, hist, fut, sc, stats):', '    """Last LOOKBACK rows of history + the HORIZON future rows -> forecast in original units' + (quant ? ' (one column per quantile)' : '') + '."""',
      '    xp, _, _ = arrays(hist.tail(LOOKBACK), sc, stats)', '    _, xf, _ = arrays(fut.head(HORIZON), sc, stats)',
      '    if len(xp) < LOOKBACK:', '        xp = np.vstack([np.zeros((LOOKBACK - len(xp), xp.shape[1]), np.float32), xp])',
      '    with torch.no_grad():', '        p = net(torch.from_numpy(xp[None]).to(DEVICE), torch.from_numpy(xf[None]).to(DEVICE))[0].cpu().numpy()',
      '    mu, sd = stats', '    return p[:len(fut)] * sd + mu', '', '',
      'def main():', '    df = load(DATA)', '    times = np.sort(df[TIME].unique())', '    cutoff = times[-HORIZON]', '    train = df[df[TIME] < cutoff]');
    if (tuned) L.push('    params = {}', '    if TUNE:', '        print(f"Tuning (up to {TUNE_TRIALS} trials of {TUNE_EPOCHS} epochs):")', '        params = tune(train)');
    L.push('    sc, stats = fit_scaler(train), series_stats(train)', '    X, F, Y, E = build(train, sc, stats)',
      '    print(f"{len(X):,} training windows of {LOOKBACK} steps from {df.groupby(SERIES).ngroups} series, on {DEVICE}")',
      '    n_in, n_fut = X.shape[2], F.shape[2]', '    net = train_net(X, F, Y, E' + (tuned ? ', **params' : '') + ')', '    table, errors = [], []', '    for key, s in df.groupby(SERIES, sort=False):',
      '        hist, test = s[s[TIME] < cutoff], s[s[TIME] >= cutoff]', '        if len(test) != HORIZON or len(hist) < SEASON + 1:', '            continue',
      '        f = forecast_series(net, hist, test, sc, stats[key_of(key)])', '        y, h = test[TARGET].to_numpy(float), hist[TARGET].to_numpy(float)');
    if (quant) L.push('        f, lo, hi = f[:, 1], f[:, 0], f[:, 2]', '        row = scores(y, f, seasonal_naive(h, len(y)), h)', '        row["coverage"] = np.mean((y >= lo) & (y <= hi))', '        table.append(row)', '    report(table)', '    q = None  # intervals come from the quantile outputs');
    else L.push('        table.append(scores(y, f, seasonal_naive(h, len(y)), h))', '        errors.extend(np.abs(y - f)[~np.isnan(y)])', '    report(table)',
      '    q = float(np.quantile(errors, min(1.0, (1 - ALPHA) * (len(errors) + 1) / len(errors))))',
      '    print(f"  {1 - ALPHA:.0%} conformal interval: forecast +/- {q:,.4f}")');
    L.push('    if REFIT:', '        print("\\nRefitting on all data ...")', '        sc, stats = fit_scaler(df), series_stats(df)', '        net = train_net(*build(df, sc, stats)' + (tuned ? ', **params' : '') + ')',
      '    torch.save(net.state_dict(), "model.pt")',
      '    joblib.dump({"scaler": sc, "stats": stats, "n_in": n_in, "n_fut": n_fut, "q": q, "hidden": ' + (tuned ? 'params.get("hidden", HIDDEN)' : 'HIDDEN') + '}, "model.joblib")',
      '    print("\\nSaved model.pt + model.joblib. Next: python predict.py")', '', '', 'if __name__ == "__main__":', '    main()', '');
    var train = L.join('\n');
    var P = ['"""Forecast the next HORIZON periods of every series with the trained network.', '', '    python predict.py [history.csv] [future.csv]', '',
      'history.csv  recent rows (default: ' + spec.file + '); ideally LOOKBACK = ' + f.look + ' periods per series.',
      d.known.length ? 'future.csv   optional rows for the forecast period with ' + [d.time].concat(d.groups, d.known).join(', ') + '.' : 'future.csv   optional; by default the next HORIZON timestamps are generated.', '"""',
      'import sys', '', 'import joblib', 'import numpy as np', 'import pandas as pd', 'import torch', '',
      'from train import DATA, DEVICE, GROUPS, SERIES, TARGET, TIME, Net, forecast_series, key_of, load, make_future, rows_of', '', '',
      'def main(history_path=DATA, future_path=None, out="forecast.csv"):', '    meta = joblib.load("model.joblib")', '    net = Net(meta["n_in"], meta["n_fut"], meta["hidden"]).to(DEVICE)',
      '    net.load_state_dict(torch.load("model.pt", map_location=DEVICE))', '    net.eval()', '    history = load(history_path)',
      '    future = make_future(history, load(future_path) if future_path else None)', '    parts = []',
      '    for key, s in history.groupby(SERIES, sort=False):', '        fut = rows_of(future, key).sort_values(TIME)',
      '        stats = meta["stats"].get(key_of(key)) or (float(s[TARGET].mean()), float(s[TARGET].std() or 1.0))  # a new series',
      '        f = forecast_series(net, s, fut, meta["scaler"], stats)'];
    if (quant) P.push('        parts.append(fut[SERIES + [TIME]].head(len(f)).assign(forecast=f[:, 1], lo=f[:, 0], hi=f[:, 2]))');
    else P.push('        parts.append(fut[SERIES + [TIME]].head(len(f)).assign(forecast=f, lo=f - meta["q"], hi=f + meta["q"]))');
    P.push('    result = pd.concat(parts, ignore_index=True)', '    if not GROUPS:', '        result = result.drop(columns=["_series"])', '    result.to_csv(out, index=False)',
      '    print(f"Wrote {len(result):,} forecasts to {out}")', '', '', 'if __name__ == "__main__":', '    main(*sys.argv[1:3])', '');
    return { train: train, predict: P.join('\n'), requirements: req(m, ['joblib>=1.3'], tuned) };
  }

  /* ---------- template: pretrained foundation models (zero-shot: nothing to train) */
  var FM = {
    chronos: { imp: ['from chronos import BaseChronosPipeline'], cfg: ['MODEL_ID = "amazon/chronos-2"  # or "amazon/chronos-bolt-small": smaller and faster, but univariate'],
      covariates: true, load: ['        _model = BaseChronosPipeline.from_pretrained(MODEL_ID, device_map=DEVICE)'],
      body: ['    ids = lambda f: f[SERIES].astype(str).agg("|".join, axis=1)',
        '    cols = [TIME, TARGET] + [c for c in KNOWN + PAST if c in history]',
        '    context = history.dropna(subset=[TARGET])[cols].assign(_id=ids(history.dropna(subset=[TARGET])))',
        '    fut = future.assign(_id=ids(future))', '    for c in KNOWN:', '        context[c] = context[c].ffill().fillna(0)', '        fut[c] = fut[c].ffill().fillna(0)',
        '    h = int(fut.groupby("_id").size().max())',
        '    # Chronos-2 treats extra columns in `context` as past-only covariates, and columns also in `future_df` as known ahead.',
        '    out = get_model().predict_df(context, future_df=fut[["_id", TIME] + KNOWN] if KNOWN else None, id_column="_id",',
        '                                 timestamp_column=TIME, target=TARGET, prediction_length=h, quantile_levels=QUANTILES)',
        '    out = out.rename(columns={"predictions": "forecast", str(QUANTILES[0]): "lo", str(QUANTILES[-1]): "hi"})',
        '    res = fut.merge(out[["_id", TIME, "forecast", "lo", "hi"]], on=["_id", TIME], how="left")', '    return res[SERIES + [TIME, "forecast", "lo", "hi"]]'] },
    timesfm: { imp: ['import timesfm'], cfg: ['MODEL_ID = "google/timesfm-2.5-200m-pytorch"  # Apache-2.0 weights. TimesFM 3.0 exists, but its weights are non-commercial only.',
      'CONTEXT = 1024  # past steps it reads per series (2.5 handles up to 16k)'], covariates: false,
      load: ['        _model = timesfm.TimesFM_2p5_200M_torch.from_pretrained(MODEL_ID)',
        '        _model.compile(timesfm.ForecastConfig(max_context=CONTEXT, max_horizon=max(256, HORIZON), normalize_inputs=True,',
        '                                              use_continuous_quantile_head=True, force_flip_invariance=True,',
        '                                              infer_is_positive=True, fix_quantile_crossing=True))'],
      body: ['    keys, inputs = [], []', '    for key, s in history.dropna(subset=[TARGET]).groupby(SERIES, sort=False):',
        '        keys.append(key_of(key))', '        inputs.append(s[TARGET].to_numpy(float)[-CONTEXT:])',
        '    point, quant = get_model().forecast(horizon=HORIZON, inputs=inputs)',
        '    parts = []', '    for i, key in enumerate(keys):', '        fut = rows_of(future, key).sort_values(TIME).head(HORIZON)', '        n = len(fut)',
        '        # quant[..., 0] is the mean, then the deciles 0.1 ... 0.9: index 1 = P10, index 9 = P90',
        '        parts.append(fut[SERIES + [TIME]].assign(forecast=point[i][:n], lo=quant[i][:n, 1], hi=quant[i][:n, 9]))',
        '    return pd.concat(parts, ignore_index=True)'] }
  };
  function genFM(spec, m, d, title) {
    var F = FM[m.slug];
    var L = [header(spec, m, d, title, ['', 'Zero-shot: a pretrained model reads each series\' history and forecasts it. Nothing is fitted to your data,',
      'so train.py only measures how good the forecasts are on the last HORIZON periods. The weights download',
      'from Hugging Face the first time (hundreds of MB).', '',
      'Run:', '    pip install -r requirements.txt', '    python train.py                         # scores the last HORIZON periods of every series',
      '    python predict.py [history.csv] [future.csv]   # forecast -> forecast.csv'])];
    L.push('import warnings', '', 'import numpy as np', 'import pandas as pd', 'import torch', F.imp.join('\n'), '', 'warnings.filterwarnings("ignore")', '');
    L = L.concat(fcConfig(spec, d, m, [
      'KNOWN = ' + (F.covariates ? pyList(d.known, 8) + '  # known-ahead covariates' : '[]  # univariate here' + (d.known.length ? ': ' + d.known.join(', ') + ' not used' : '')),
      'PAST = ' + (F.covariates ? pyList(d.past, 7) + '  # past-only covariates' : '[]'),
      'BOOLEAN = ' + pyList(F.covariates ? d.bool : [], 10), 'SERIES = GROUPS or ["_series"]',
      'QUANTILES = [0.1, 0.5, 0.9]', 'ALPHA = 0.2  # the P10-P90 band should hold about 80% of actuals'].concat(F.cfg,
      ['DEVICE = "cuda" if torch.cuda.is_available() else "cpu"'])));
    if (spec.tune) L.push('# Cross-validated tuning: nothing to tune, the model is used zero-shot.');
    L.push('', boolParse(), '', '');
    L = L.concat(fcLoad(false));
    L.push('', '', '_model = None', '', '', 'def get_model():', '    """Load the pretrained model once."""', '    global _model', '    if _model is None:');
    L = L.concat(F.load);
    L.push('    return _model', '', '', 'def forecast(history, future):', '    """Zero-shot forecast of the rows in `future` from `history`. Returns SERIES + TIME + forecast, lo, hi."""');
    L = L.concat(F.body);
    L.push('', '', 'def main():', '    df = load(DATA).dropna(subset=[TARGET])', '    times = np.sort(df[TIME].unique())', '    cutoff = times[-HORIZON]',
      '    train, test = df[df[TIME] < cutoff], df[df[TIME] >= cutoff]',
      '    print(f"{len(df):,} rows, {df.groupby(SERIES).ngroups} series; zero-shot with {MODEL_ID} on {DEVICE}")',
      '    fc = forecast(train, test.drop(columns=[TARGET]))', '    res = test.merge(fc, on=SERIES + [TIME])', '    table = []',
      '    for key, s in res.groupby(SERIES, sort=False):', '        hist = rows_of(train, key)[TARGET].to_numpy(float)', '        y, f = s[TARGET].to_numpy(float), s["forecast"].to_numpy(float)',
      '        row = scores(y, f, seasonal_naive(hist, len(y)), hist)', '        row["coverage"] = np.mean((y >= s["lo"]) & (y <= s["hi"]))', '        table.append(row)',
      '    report(table).to_csv("evaluation.csv", index=False)', '    print("\\nNothing to train. Next: python predict.py")', '', '', 'if __name__ == "__main__":', '    main()', '');
    var P = ['"""Forecast the next HORIZON periods of every series, zero-shot.', '', '    python predict.py [history.csv] [future.csv]', '',
      F.covariates && d.known.length ? 'future.csv: optional rows for the forecast period with ' + [d.time].concat(d.groups, d.known).join(', ') + '.' : 'future.csv: optional; by default the next HORIZON timestamps are generated.', '"""',
      'import sys', '', 'from train import DATA, GROUPS, SERIES, TARGET, forecast, load, make_future', '', '',
      'def main(history_path=DATA, future_path=None, out="forecast.csv"):', '    history = load(history_path).dropna(subset=[TARGET])',
      '    future = make_future(history, load(future_path) if future_path else None)', '    result = forecast(history, future)',
      '    if not GROUPS:', '        result = result.drop(columns=["_series"])', '    result.to_csv(out, index=False)', '    print(f"Wrote {len(result):,} forecasts to {out}")', '', '',
      'if __name__ == "__main__":', '    main(*sys.argv[1:3])', ''];
    return { train: L.join('\n'), predict: P.join('\n'), requirements: req(m, ['torch>=2.1']) };
  }

  /* ---------- shared by the anomaly and clustering templates: columns, loading, calendar parts */
  function unsupColumns(spec, d, L, watched) {
    var dates = uniq(d.dates.concat(d.time ? [d.time] : [])), eng = [];
    dates.forEach(function (c) { eng.push(c + '_month_sin', c + '_month_cos', c + '_dow', c + '_hour'); });
    L.push('DATA = ' + py(spec.file));
    L.push('NUMERIC = ' + pyList(d.num.concat(watched ? [d.target] : []), 10) + (watched ? '  # includes ' + d.target + ', the metric you watch' : ''));
    L.push('BOOLEAN = ' + pyList(d.bool, 10), 'CATEGORICAL = ' + pyList(d.cat, 14), 'DATES = ' + pyList(dates, 8));
    L.push('KEY_DRIVERS = ' + pyList(d.key, 14) + '  # ★ the columns you highlighted');
    if (d.txt.length) L.push('# text columns are left out: ' + d.txt.join(', '));
    if (d.ids.length) L.push('# id columns are never features: ' + d.ids.join(', '));
    L.push('ENGINEERED = ' + pyList(eng, 13) + '  # calendar parts, made in add_features()');
    L.push('NUM_FEATURES = NUMERIC + BOOLEAN + ENGINEERED', 'CAT_FEATURES = CATEGORICAL', 'FEATURES = NUM_FEATURES + CAT_FEATURES', 'SEED = 42');
    return dates.length;
  }
  function unsupLoad(hasDates) {
    var L = ['def load(path):', '    df = pd.read_csv(path)', '    for c in DATES:', '        df[c] = pd.to_datetime(df[c], errors="coerce")', '    return df', '', '',
      'def add_features(df):', '    """Types and calendar parts. Runs on training data and on new rows alike."""', '    df = df.copy()',
      '    for c in NUMERIC:', '        df[c] = pd.to_numeric(df[c], errors="coerce")', '    for c in BOOLEAN:', '        df[c] = df[c].astype(str).str.strip().str.lower().map(TRUTHY)',
      '    for c in CATEGORICAL:', '        df[c] = df[c].fillna("NA").astype(str)'];
    if (hasDates) L.push('    for c in DATES:  # months on a circle, so December sits next to January', '        d = df[c]',
      '        df[c + "_month_sin"] = np.sin(2 * np.pi * d.dt.month / 12)', '        df[c + "_month_cos"] = np.cos(2 * np.pi * d.dt.month / 12)',
      '        df[c + "_dow"] = d.dt.dayofweek', '        df[c + "_hour"] = d.dt.hour');
    L.push('    return df', '', '');
    return L;
  }
  function unsupPrep(ordinal) {
    return ['def make_prep():', '    """Impute, ' + (ordinal ? 'and encode categories as integers (trees need no scaling)' : 'scale and one-hot encode, so every column counts on the same scale') + '."""',
      ordinal ? '    numeric = SimpleImputer(strategy="median")' : '    numeric = Pipeline([("impute", SimpleImputer(strategy="median")), ("scale", StandardScaler())])',
      ordinal ? '    categorical = OrdinalEncoder(handle_unknown="use_encoded_value", unknown_value=-1)' : '    categorical = OneHotEncoder(handle_unknown="ignore", min_frequency=10, sparse_output=False)',
      '    return ColumnTransformer([("num", numeric, NUM_FEATURES), ("cat", categorical, CAT_FEATURES)], sparse_threshold=0)', '', ''];
  }

  /* ---------- template: anomaly detection on rows */
  var DETECT = {
    iforest: { imp: 'from sklearn.ensemble import IsolationForest', est: 'IsolationForest(n_estimators=300, max_samples="auto", random_state=SEED, n_jobs=-1)', ordinal: true },
    lof: { imp: 'from sklearn.neighbors import LocalOutlierFactor', est: 'LocalOutlierFactor(n_neighbors=35, novelty=True)' },
    ocsvm: { imp: 'from sklearn.svm import OneClassSVM', est: 'OneClassSVM(nu=0.05, gamma="scale")' },
    robustcov: { imp: 'from sklearn.covariance import EllipticEnvelope', est: 'EllipticEnvelope(support_fraction=None, random_state=SEED)' }
  };
  function genAnom(spec, m, d, title) {
    var D = DETECT[m.slug], label = d.target && d.targetType === 'boolean', watched = d.target && d.targetType === 'numeric', tuned = spec.tune && RI.tunable(spec, m);
    var L = [header(spec, m, d, title, ['', 'Unsupervised: the detector learns what normal rows look like and scores every row by how unusual it is.',
      label ? 'Your label column is never used for fitting, only to measure the detector afterwards.' : 'No labels needed. Add a true/false column of known anomalies as y to measure it.', '',
      'Run:', '    pip install -r requirements.txt', '    python train.py             # ' + (tuned ? 'tunes against your labels, ' : '') + 'scores every row -> anomalies.csv, saves model.joblib',
      '    python predict.py new.csv   # scores new rows -> predictions.csv'])];
    L.push('import warnings', '', 'import joblib', 'import numpy as np');
    if (tuned) L.push('import optuna');
    L.push('import pandas as pd', 'from sklearn.compose import ColumnTransformer', 'from sklearn.impute import SimpleImputer');
    if (label) L.push('from sklearn.metrics import average_precision_score, roc_auc_score');
    if (tuned) L.push('from sklearn.model_selection import StratifiedKFold');
    L.push('from sklearn.pipeline import Pipeline', 'from sklearn.preprocessing import ' + (D.ordinal ? 'OrdinalEncoder' : 'OneHotEncoder, StandardScaler'), D.imp, '', 'warnings.filterwarnings("ignore")', '');
    var hasDates = unsupColumns(spec, d, L, watched);
    L.push('LABEL = ' + (label ? py(d.target) + '  # known anomalies (true/false): only to measure, never to fit' : 'None  # mark a true/false column of known anomalies as y to measure the detector'));
    L.push('CONTAMINATION = 0.01  # expected share of anomalies: sets the flag threshold, not the scores', 'TOP = 15  # most unusual rows to print');
    if (tuned) L = L.concat(tuneConfig(30, 900, 5, 'Optuna search scored by average precision against LABEL'));
    L.push('', boolParse(), '', '');
    L = L.concat(unsupLoad(hasDates), unsupPrep(D.ordinal));
    L.push('def make_model():', '    return Pipeline([("prep", make_prep()), ("model", ' + D.est + ')])', '', '',
      'def anomaly_score(model, X):', '    """Higher = more unusual. (scikit-learn\'s score_samples is higher = more normal, so it is flipped.)"""', '    return -model.score_samples(X)', '', '');
    if (m.slug === 'lof') L.push('def train_scores(model, X):', '    """LOF judges each training row by its neighbours, leaving the row itself out."""', '    return -model[-1].negative_outlier_factor_', '', '');
    L.push('def explain(df, scores, top):', '    """Why the top rows look odd: their numeric columns furthest from typical, as robust z-scores."""',
      '    if not NUMERIC:', '        return', '    num = df[NUMERIC].astype(float)', '    med = num.median()',
      '    mad = ((num - med).abs().median() * 1.4826).replace(0, np.nan)', '    z = (num - med) / mad',
      '    for i in np.argsort(-scores)[:top]:', '        cols = z.iloc[i].abs().sort_values(ascending=False).head(3).index',
      '        why = ", ".join(f"{c} = {num[c].iloc[i]:,.4g} (z {z[c].iloc[i]:+.1f})" for c in cols)',
      '        print(f"  row {df.index[i]:>7}  score {scores[i]:.4f}   {why}")', '', '');
    if (label) L.push('def evaluate(y, scores, flags):', '    """How the scores line up with the known anomalies."""',
      '    k = max(int(y.sum()), 1)', '    top = np.argsort(-scores)[:k]',
      '    print(f"  ROC AUC        {roc_auc_score(y, scores):.4f}   (0.5 = random)")',
      '    print(f"  PR AUC (AP)    {average_precision_score(y, scores):.4f}   (random: {y.mean():.4f})")',
      '    print(f"  precision@{k:<5}{y[top].mean():.4f}   (share of the {k} highest scores that are real anomalies)")',
      '    if flags.any():', '        print(f"  flagged rows: {y[flags].mean():.1%} are real anomalies; they catch {flags[y == 1].mean():.1%} of all anomalies")', '', '');
    if (tuned) {
      L = L.concat(spaceFn(SPACE[m.slug]), WITH_PARAMS);
      L.push('def tune(X, y):', '    """Fit on the training folds (labels unseen), score the held-out fold, average the precision."""',
        '    if y.sum() < FOLDS:', '        print("  too few labelled anomalies to tune; using the defaults")', '        return {}',
        '    cv = StratifiedKFold(FOLDS, shuffle=True, random_state=SEED)', '',
        '    def objective(trial):', '        params, aps = search_space(trial), []', '        for tr, va in cv.split(X, y):',
        '            model = with_params(make_model(), params).fit(X.iloc[tr])', '            aps.append(average_precision_score(y[va], anomaly_score(model, X.iloc[va])))',
        '        return float(np.mean(aps))', '');
      L = L.concat(studyLines('maximize', 'CV average precision'), ['', '']);
    }
    L.push('def main():', '    raw = load(DATA)', '    df = add_features(raw)');
    if (label) L.push('    y = df[LABEL].astype(str).str.strip().str.lower().map(TRUTHY).fillna(0).to_numpy(int)', '    print(f"{len(df):,} rows, {y.sum():,} labelled anomalies ({y.mean():.2%})")');
    else L.push('    print(f"{len(df):,} rows")');
    if (tuned) L.push('    params = {}', '    if TUNE:', '        print(f"\\nTuning ({FOLDS}-fold CV, up to {TUNE_TRIALS} trials):")', '        params = tune(df[FEATURES], y)', '    model = with_params(make_model(), params).fit(df[FEATURES])');
    else L.push('    model = make_model().fit(df[FEATURES])');
    L.push('    scores = ' + (m.slug === 'lof' ? 'train_scores' : 'anomaly_score') + '(model, df[FEATURES])', '    threshold = float(np.quantile(scores, 1 - CONTAMINATION))', '    flags = scores >= threshold',
      '    print(f"\\nFlagged {flags.sum():,} rows: the top {CONTAMINATION:.1%} of scores (threshold {threshold:.4f})")');
    if (label) L.push('    print("\\nAgainst your labels:")', '    evaluate(y, scores, flags)');
    L.push('    print("\\nThe most unusual rows, and what stands out:")', '    explain(df, scores, TOP)',
      '    out = raw.assign(anomaly_score=scores, is_anomaly=flags).sort_values("anomaly_score", ascending=False)', '    out.to_csv("anomalies.csv", index=False)',
      '    joblib.dump({"model": model, "features": FEATURES, "threshold": threshold}, "model.joblib")',
      '    print("\\nWrote anomalies.csv (most unusual first) and model.joblib. Next: python predict.py new.csv")', '', '', 'if __name__ == "__main__":', '    main()', '');
    var P = ['"""Score new rows with the detector from train.py.', '', '    python predict.py new.csv [predictions.csv]', '', 'new.csv needs the same columns as ' + spec.file + '.', '"""',
      'import sys', '', 'import joblib', '', 'from train import add_features, anomaly_score, load', '', '',
      'def main(path, out="predictions.csv"):', '    bundle = joblib.load("model.joblib")', '    df = load(path)',
      '    scores = anomaly_score(bundle["model"], add_features(df)[bundle["features"]])',
      '    result = df.assign(anomaly_score=scores, is_anomaly=scores >= bundle["threshold"])', '    result.to_csv(out, index=False)',
      '    print(f"Scored {len(result):,} rows, {int(result.is_anomaly.sum()):,} flagged -> {out}")', '', '',
      'if __name__ == "__main__":', '    if len(sys.argv) < 2:', '        sys.exit("usage: python predict.py new.csv [predictions.csv]")', '    main(*sys.argv[1:3])', ''];
    return { train: L.join('\n'), predict: P.join('\n'), requirements: req(m, ['joblib>=1.3', 'scikit-learn>=1.4'], tuned) };
  }

  /* ---------- template: anomalies in a metric over time (STL residuals) */
  function genAnomTS(spec, m, d, title) {
    var f = RI.FREQ[spec.freq];
    var L = [header(spec, m, d, title, ['', 'Per series: STL splits the metric into trend + season + remainder; a remainder far from typical',
      '(robust z-score above Z) is flagged. Every flag comes with the value it expected instead.', '',
      'Run:', '    pip install -r requirements.txt', '    python train.py                 # flags anomalies in ' + spec.file + ' -> anomalies.csv',
      '    python predict.py [recent.csv]  # the same on newer data -> predictions.csv'])];
    L.push('import sys', 'import warnings', '', 'import numpy as np', 'import pandas as pd', 'from statsmodels.tsa.seasonal import STL', '', 'warnings.filterwarnings("ignore")', '');
    L.push('DATA = ' + py(spec.file), 'TARGET = ' + py(d.target) + '  # the metric you watch', 'TIME = ' + py(d.time),
      'GROUPS = ' + pyList(d.groups, 9) + '  # one series per group; [] = a single series',
      'SEASON = ' + f.season + '  # season length for ' + f.name.toLowerCase() + ' data', 'Z = 3.5  # flag when |robust z| is above this', 'SERIES = GROUPS or ["_series"]');
    if (spec.tune) L.push('# Cross-validated tuning: not available here (no labels to score against). Lower Z to flag more.');
    L.push('', '', 'def load(path):', '    df = pd.read_csv(path)', '    df[TIME] = pd.to_datetime(df[TIME], errors="coerce")', '    df[TARGET] = pd.to_numeric(df[TARGET], errors="coerce")',
      '    for c in GROUPS:', '        df[c] = df[c].fillna("NA").astype(str)', '    if not GROUPS:', '        df["_series"] = "all"',
      '    return df.dropna(subset=[TIME]).sort_values(SERIES + [TIME]).reset_index(drop=True)', '', '',
      'def detect(s):', '    """One series -> expected value, robust z-score and flag for every row."""',
      '    y = s[TARGET].interpolate().bfill().ffill().to_numpy(float)',
      '    if SEASON > 1 and len(y) >= 2 * SEASON:', '        fit = STL(y, period=SEASON, robust=True).fit()', '        expected = fit.trend + fit.seasonal',
      '    else:  # too short for a season: a rolling median is the expectation', '        expected = pd.Series(y).rolling(7, center=True, min_periods=1).median().to_numpy()',
      '    resid = y - expected', '    mad = np.median(np.abs(resid - np.median(resid))) * 1.4826 or 1e-9', '    z = (resid - np.median(resid)) / mad',
      '    return s.assign(expected=expected, z=z, is_anomaly=np.abs(z) > Z)', '', '',
      'def run(df):', '    return pd.concat([detect(s) for _, s in df.groupby(SERIES, sort=False)], ignore_index=True)', '', '',
      'def main(path=DATA, out="anomalies.csv"):', '    df = load(path)', '    res = run(df)', '    flagged = res[res.is_anomaly]',
      '    print(f"{len(res):,} rows in {df.groupby(SERIES).ngroups} series; flagged {len(flagged):,} ({len(flagged) / max(len(res), 1):.2%}) with |z| > {Z}")',
      '    print("\\nThe largest surprises:")', '    for _, r in flagged.reindex(flagged.z.abs().sort_values(ascending=False).index).head(15).iterrows():',
      '        tag = " ".join(str(r[c]) for c in GROUPS) + "  " if GROUPS else ""',
      '        print(f"  {tag}{r[TIME]}  {TARGET} {r[TARGET]:,.4g}, expected {r[\'expected\']:,.4g}  (z {r[\'z\']:+.1f})")',
      '    (res if GROUPS else res.drop(columns=["_series"])).to_csv(out, index=False)', '    print(f"\\nWrote {out}")', '', '',
      'if __name__ == "__main__":', '    main(*sys.argv[1:2])', '');
    var P = ['"""Flag anomalies in newer data. STL refits on whatever history you pass, so there is no model file.', '', '    python predict.py [recent.csv] [predictions.csv]', '',
      'recent.csv: same columns as ' + spec.file + ', ideally with a few seasons of history before the part you check.', '"""',
      'import sys', '', 'from train import DATA, main', '', '', 'if __name__ == "__main__":', '    main((sys.argv[1:2] or [DATA])[0], (sys.argv[2:3] or ["predictions.csv"])[0])', ''];
    return { train: L.join('\n'), predict: P.join('\n'), requirements: req(m) };
  }

  /* ---------- template: clustering */
  var CLUS = {
    kmeans: { imp: ['from sklearn.cluster import KMeans'], params: '{}', pick: 'silhouette', kname: 'n_clusters',
      fn: ['    model = KMeans(n_init="auto", random_state=SEED, **params).fit(Z)', '    return model.labels_, model'] },
    gmm: { imp: ['from sklearn.mixture import GaussianMixture'], params: '{"covariance_type": "full"}', pick: 'bic', kname: 'n_components',
      fn: ['    model = GaussianMixture(random_state=SEED, n_init=2, **params).fit(Z)', '    return model.predict(Z), model'] },
    hdbscan: { imp: ['from sklearn.cluster import HDBSCAN', 'from sklearn.neighbors import KNeighborsClassifier'], params: '{"min_cluster_size": 25, "min_samples": None}', pick: null,
      fn: ['    labels = HDBSCAN(**params).fit_predict(Z)', '    return labels, KNeighborsClassifier(n_neighbors=5).fit(Z, labels)  # HDBSCAN cannot label new rows itself'] },
    agglo: { imp: ['from sklearn.cluster import AgglomerativeClustering', 'from sklearn.neighbors import NearestCentroid'], params: '{"linkage": "ward"}', pick: 'silhouette', kname: 'n_clusters',
      fn: ['    rng = np.random.default_rng(SEED)', '    idx = np.sort(rng.choice(len(Z), MAX_ROWS, replace=False)) if len(Z) > MAX_ROWS else np.arange(len(Z))',
        '    fitted = AgglomerativeClustering(**params).fit_predict(Z[idx])  # O(n^2) memory: fit on at most MAX_ROWS rows',
        '    assign = NearestCentroid().fit(Z[idx], fitted)', '    labels = assign.predict(Z)', '    labels[idx] = fitted', '    return labels, assign'] }
  };
  function genClus(spec, m, d, title) {
    var C = CLUS[m.slug], tuned = spec.tune && RI.tunable(spec, m), prof = d.target;
    var L = [header(spec, m, d, title, ['', 'Groups similar rows. There is no target: the groups are judged by how tight and well separated they are',
      '(silhouette, Davies-Bouldin), then described in your own columns so you can name them.', '',
      'Run:', '    pip install -r requirements.txt', '    python train.py             # ' + (tuned ? 'tunes, then ' : '') + 'clusters every row -> clusters.csv, saves model.joblib',
      '    python predict.py new.csv   # assigns new rows to the clusters -> predictions.csv'])];
    L.push('import warnings', '', 'import joblib', 'import numpy as np');
    if (tuned) L.push('import optuna');
    L.push('import pandas as pd', 'from sklearn.compose import ColumnTransformer', 'from sklearn.impute import SimpleImputer',
      'from sklearn.metrics import calinski_harabasz_score, davies_bouldin_score, silhouette_score', 'from sklearn.pipeline import Pipeline',
      'from sklearn.preprocessing import OneHotEncoder, StandardScaler', C.imp.join('\n'), '', 'warnings.filterwarnings("ignore")', '');
    var hasDates = unsupColumns(spec, d, L, false);
    L.push('PROFILE = ' + (prof ? py(prof) + '  # described per cluster, never used to form them' : 'None  # a column to describe per cluster (never used to form them)'));
    L.push('PARAMS = ' + C.params);
    if (C.pick) L.push('K_RANGE = range(2, 11)  # numbers of clusters to try');
    if (m.slug === 'agglo') L.push('MAX_ROWS = 20000  # hierarchical clustering is O(n^2) in memory; the rest join the nearest centroid');
    L.push('SAMPLE = 5000  # rows used for silhouette scores (they cost O(n^2))');
    if (tuned) L = L.concat(tuneConfig(40, 900, 0, 'Optuna search maximising the silhouette (an internal score: there are no labels)'));
    L.push('', boolParse(), '', '');
    L = L.concat(unsupLoad(hasDates), unsupPrep(false));
    L.push('def cluster(Z, params):', '    """Cluster the encoded rows. Returns (labels, a model that assigns new rows)."""');
    L = L.concat(C.fn);
    L.push('', '', 'def silhouette(Z, labels):', '    """Silhouette on a sample; noise points (label -1) are left out."""', '    ok = labels >= 0',
      '    if len(set(labels[ok])) < 2:', '        return -1.0', '    return float(silhouette_score(Z[ok], labels[ok], sample_size=min(SAMPLE, int(ok.sum())), random_state=SEED))', '', '');
    if (C.pick === 'silhouette') L.push('def choose_k(Z):', '    """Try every k in K_RANGE and keep the best silhouette."""', '    best = None', '    for k in K_RANGE:',
      '        s = silhouette(Z, cluster(Z, dict(PARAMS, ' + C.kname + '=k))[0])', '        print(f"  k = {k:2d}   silhouette {s:.4f}")', '        if best is None or s > best[1]:', '            best = (k, s)',
      '    return dict(PARAMS, ' + C.kname + '=best[0])', '', '');
    if (C.pick === 'bic') L.push('def choose_k(Z):', '    """Try every K in K_RANGE and keep the lowest BIC (fit vs. number of parameters)."""', '    best = None', '    for k in K_RANGE:',
      '        bic = cluster(Z, dict(PARAMS, ' + C.kname + '=k))[1].bic(Z)', '        print(f"  K = {k:2d}   BIC {bic:,.1f}")', '        if best is None or bic < best[1]:', '            best = (k, bic)',
      '    return dict(PARAMS, ' + C.kname + '=best[0])', '', '');
    if (tuned) {
      L = L.concat(spaceFn(SPACE[m.slug]));
      L.push('def tune(Z):', '    """Optuna over the settings above, maximising the silhouette."""', '', '    def objective(trial):', '        return silhouette(Z, cluster(Z, search_space(trial))[0])', '');
      L = L.concat(studyLines('maximize', 'silhouette'), ['', '']);
    }
    L.push('def profile(df, labels):', '    """What each cluster looks like, in your own columns."""', '    g = df.assign(cluster=labels).groupby("cluster")',
      '    table = pd.DataFrame({"rows": g.size(), "share": g.size() / len(df)})', '    for c in NUMERIC + BOOLEAN:', '        table[c] = g[c].mean()',
      '    for c in CATEGORICAL:', '        table[c] = g[c].agg(lambda s: s.mode().iat[0] if len(s.mode()) else "")',
      '    if PROFILE:', '        y = pd.to_numeric(df[PROFILE], errors="coerce")', '        if y.isna().all():  # true/false or text: the share of truthy values',
      '            y = df[PROFILE].astype(str).str.strip().str.lower().map(TRUTHY)', '        table[PROFILE + " (mean)"] = y.groupby(labels).mean()', '    return table', '', '',
      'def main():', '    raw = load(DATA)', '    df = add_features(raw)', '    prep = make_prep().fit(df[FEATURES])', '    Z = prep.transform(df[FEATURES])',
      '    print(f"{len(df):,} rows, {Z.shape[1]} columns after encoding")', '    params = PARAMS');
    if (tuned) {
      L.push('    if TUNE:', '        print(f"\\nTuning (up to {TUNE_TRIALS} trials):")', '        params = tune(Z)');
      if (C.pick) L.push('    else:', '        print("\\nChoosing the number of clusters:")', '        params = choose_k(Z)');
    } else if (C.pick) L.push('    print("\\nChoosing the number of clusters:")', '    params = choose_k(Z)');
    L.push('    labels, assigner = cluster(Z, params)', '    k = len(set(labels) - {-1})', '    ok = labels >= 0',
      '    print(f"\\n{k} clusters" + (f", {np.sum(~ok):,} rows left as noise" if (~ok).any() else ""))',
      '    if k >= 2:', '        print(f"  silhouette         {silhouette(Z, labels):.4f}   (1 = tight and separate, 0 = overlapping)")',
      '        print(f"  Davies-Bouldin     {davies_bouldin_score(Z[ok], labels[ok]):.4f}   (lower is better)")',
      '        print(f"  Calinski-Harabasz  {calinski_harabasz_score(Z[ok], labels[ok]):,.1f}   (higher is better)")',
      '    print("\\nWhat the clusters look like:")', '    with pd.option_context("display.width", 200, "display.max_columns", 40, "display.float_format", "{:,.3g}".format):',
      '        print(profile(df, labels).to_string())', '    raw.assign(cluster=labels).to_csv("clusters.csv", index=False)',
      '    joblib.dump({"prep": prep, "assigner": assigner, "features": FEATURES, "params": params}, "model.joblib")',
      '    print("\\nWrote clusters.csv and model.joblib. Next: python predict.py new.csv")', '', '', 'if __name__ == "__main__":', '    main()', '');
    var P = ['"""Assign new rows to the clusters found by train.py.', '', '    python predict.py new.csv [predictions.csv]', '', 'new.csv needs the same columns as ' + spec.file + '.', '"""',
      'import sys', '', 'import joblib', '', 'from train import add_features, load', '', '',
      'def main(path, out="predictions.csv"):', '    bundle = joblib.load("model.joblib")', '    df = load(path)',
      '    Z = bundle["prep"].transform(add_features(df)[bundle["features"]])', '    result = df.assign(cluster=bundle["assigner"].predict(Z))'];
    if (m.slug === 'gmm') P.push('    proba = bundle["assigner"].predict_proba(Z)  # soft memberships', '    for k in range(proba.shape[1]):', '        result[f"p_cluster_{k}"] = proba[:, k]');
    P.push('    result.to_csv(out, index=False)', '    print(f"Assigned {len(result):,} rows -> {out}")', '', '',
      'if __name__ == "__main__":', '    if len(sys.argv) < 2:', '        sys.exit("usage: python predict.py new.csv [predictions.csv]")', '    main(*sys.argv[1:3])', '');
    return { train: L.join('\n'), predict: P.join('\n'), requirements: req(m, ['joblib>=1.3', 'scikit-learn>=1.4'], tuned) };
  }

  /* spec + model slug -> {train, predict, requirements} */
  RI.generate = function (spec, slug, title) {
    spec = RI.cleanSpec(spec);
    var m = RI.MODEL[slug], d = RI.derive(spec);
    if (!m) return null;
    title = title || (m.name + ' for ' + (spec.task === 'cluster' ? 'segments' : spec.task === 'anomaly' && !d.target ? 'unusual rows' : d.target || 'your target'));
    if (m.tmpl === 'tab') return spec.task === 'forecast' ? genTabForecast(spec, m, d, title) : genTab(spec, m, d, title);
    if (m.tmpl === 'torch') return genTorch(spec, m, d, title);
    if (m.tmpl === 'fm') return genFM(spec, m, d, title);
    if (m.tmpl === 'anom') return genAnom(spec, m, d, title);
    if (m.tmpl === 'anomts') return genAnomTS(spec, m, d, title);
    if (m.tmpl === 'clus') return genClus(spec, m, d, title);
    return genStat(spec, m, d, title);
  };
  RI.FILES = [['train', 'train.py'], ['predict', 'predict.py'], ['requirements', 'requirements.txt']];

  /* ------------------------------------------------------------------ highlighting */
  var KW = ' False None True and as assert break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield ';
  var BI = ' print len range list dict set tuple zip enumerate min max sum abs float int str bool isinstance sorted any all super open round map hasattr getattr type np pd nn torch joblib ';
  RI.highlight = function (code) {
    var rx = /("""[\s\S]*?"""|'''[\s\S]*?'''|[rbfRBF]{0,2}"(?:\\.|[^"\\\n])*"|[rbfRBF]{0,2}'(?:\\.|[^'\\\n])*'|#[^\n]*|@\w+|\b\d+(?:\.\d+)?(?:e[-+]?\d+)?\b|\b[A-Za-z_]\w*\b)/g;
    var out = '', last = 0, prev = '', mt;
    while ((mt = rx.exec(code))) {
      out += esc(code.slice(last, mt.index));
      var t = mt[0], cls = '';
      if (t[0] === '#') cls = 'c';
      else if (t[0] === '@') cls = 'd';
      else if (/^[rbfRBF]{0,2}["']/.test(t)) cls = 's';
      else if (/^\d/.test(t)) cls = 'n';
      else if (prev === 'def' || prev === 'class') cls = 'f';
      else if (KW.indexOf(' ' + t + ' ') >= 0) cls = 'k';
      else if (BI.indexOf(' ' + t + ' ') >= 0) cls = 'b';
      out += cls ? '<span class="' + cls + '">' + esc(t) + '</span>' : esc(t);
      if (/^\w+$/.test(t)) prev = t;
      last = rx.lastIndex;
    }
    out += esc(code.slice(last));
    return out.split('\n').map(function (l) { return '<span class="l">' + (l || ' ') + '</span>'; }).join('');
  };
  /* A code listing with file tabs, copy and download. files = {train, predict, requirements}. */
  RI.codeBlock = function (files, active, extraButtons) {
    active = active || 'train';
    var name = RI.FILES.filter(function (f) { return f[0] === active; })[0][1];
    var body = active === 'requirements' ? esc(files[active] || '').split('\n').map(function (l) { return '<span class="l">' + (l || ' ') + '</span>'; }).join('') : RI.highlight(files[active] || '');
    return '<div class="ri-code" data-code><div class="ri-code-bar" role="tablist">' + RI.FILES.map(function (f) {
      return '<button type="button" class="ri-file' + (f[0] === active ? ' on' : '') + '" data-file="' + f[0] + '">' + f[1] + '</button>';
    }).join('') + '<span class="ui-spacer"></span>' + (extraButtons || '') +
      '<button type="button" class="ui-btn sm ghost" data-copy title="Copy ' + name + '">' + UI.icon('copy') + '<span>Copy</span></button>' +
      '<button type="button" class="ui-btn sm ghost" data-download title="Download ' + name + '">' + UI.icon('download') + '<span>' + (active === 'requirements' ? '.txt' : '.py') + '</span></button>' +
      '<button type="button" class="ui-btn sm ghost" data-ipynb title="Download all three files as one Jupyter notebook">' + UI.icon('notebook') + '<span>.ipynb</span></button></div>' +
      '<pre aria-label="' + esc(name) + '">' + body + '</pre></div>';
  };
  RI.copy = function (text) {
    var done = function () { UI.toast('Copied to the clipboard', 'ok'); };
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(done, function () { fallback(); });
    fallback();
    function fallback() {
      var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { UI.toast('Copy didn\'t work: select the code and copy it by hand.', 'error'); }
      ta.remove();
    }
  };
  RI.download = function (name, text) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  };
  /* Wire a container's code block: file tabs, copy, download. getFiles() returns the current files. */
  RI.wireCode = function (root, getFiles, onTab, getMeta) {
    root.addEventListener('click', function (e) {
      var f = e.target.closest('[data-file]');
      if (f && f.closest('[data-code]')) { onTab(f.getAttribute('data-file')); return; }
      var on = root.querySelector('[data-code] .ri-file.on'), key = on ? on.getAttribute('data-file') : 'train';
      var name = RI.FILES.filter(function (x) { return x[0] === key; })[0][1];
      if (e.target.closest('[data-copy]')) RI.copy(getFiles()[key] || '');
      if (e.target.closest('[data-download]')) RI.download(name, getFiles()[key] || '');
      if (e.target.closest('[data-ipynb]')) {
        var meta = getMeta ? getMeta() : {};
        var base = String(meta.title || 'robointern-listing').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'listing';
        RI.download(base + '.ipynb', RI.notebook(getFiles(), meta));
        UI.toast('Notebook downloaded: open it in Jupyter, VS Code or Colab', 'ok');
      }
    });
  };

  /* ------------------------------------------------------------------ Jupyter notebook export
     files {train, predict, requirements} + meta {title, model, spec, notes} -> .ipynb JSON text.
     train.py becomes one cell per top-level block (they are separated by two blank lines), main() runs in its own
     cell, and predict.py's main() becomes predict_new() in the same namespace (no "from train import"). */
  RI.notebook = function (files, meta) {
    meta = meta || {}; files = files || {};
    var spec = RI.cleanSpec(meta.spec || {}), m = RI.MODEL[meta.model] || null, cells = [];
    var lines = function (text) { var a = String(text).split('\n'); return a.map(function (l, i) { return i < a.length - 1 ? l + '\n' : l; }); };
    var md = function (text) { cells.push({ cell_type: 'markdown', id: 'c' + cells.length, metadata: {}, source: lines(text) }); };
    var code = function (text) {
      text = String(text || '').replace(/^\n+|\s+$/g, '');
      if (text) cells.push({ cell_type: 'code', id: 'c' + cells.length, metadata: {}, execution_count: null, outputs: [], source: lines(text) });
    };
    var docOf = function (src) { var x = /^"""([\s\S]*?)"""/.exec(src || ''); return x ? x[1].split('\nRun:')[0].trim() : ''; };
    var noDoc = function (src) { return String(src || '').replace(/^"""[\s\S]*?"""\n*/, ''); };
    var role = { feature: 'feature x', target: spec.task === 'cluster' ? 'profile only' : spec.task === 'anomaly' ? 'label / watched metric' : 'target y', time: 'time t', group: 'series g', ignore: 'ignored' };
    var head = ['# ' + (meta.title || (m ? m.name : 'RoboIntern listing')), ''];
    if (m) head.push('**Model:** ' + m.name + ' (' + m.lib + ') · **Task:** ' + (RI.TASKS[spec.task] || spec.task) + ' · **Data:** `' + spec.file + '`', '', m.summary, '');
    if (meta.notes) head.push('> ' + String(meta.notes).replace(/\n/g, '\n> '), '');
    if (m && m.eq) head.push('$$' + m.eq.replace(/\n/g, ' ') + '$$', '');
    if (m && m.obj) head.push('**Objective.** $$' + m.obj.replace(/\n/g, ' ') + '$$', '');
    if (spec.columns.length) {
      head.push('| column | role | type |', '|---|---|---|');
      spec.columns.forEach(function (c) { head.push('| `' + c.name.replace(/\|/g, '\\|') + '`' + (c.key ? ' ★' : '') + ' | ' + role[c.role] + (c.known && spec.task === 'forecast' ? ', known ahead' : '') + ' | ' + c.type + ' |'); });
      head.push('');
    }
    head.push('*Written by RoboIntern on ' + today() + '. Put `' + spec.file + '` next to this notebook and run the cells from top to bottom.*');
    md(head.join('\n'));
    var reqs = String(files.requirements || '').split('\n').map(function (l) { return l.replace(/#.*$/, '').trim(); }).filter(Boolean);
    md('## Setup');
    code('%pip install -q ' + reqs.map(function (r) { return '"' + r + '"'; }).join(' '));
    var doc = docOf(files.train);
    md('## The code\n' + (doc ? doc.split('\n').slice(1).join('\n').trim() + '\n\n' : '') + 'Configuration first: change the constants in the next cell to fit your data.');
    var hasMain = false;
    noDoc(files.train).split(/\n{3,}/).forEach(function (b) { if (/^\s*if __name__ == "__main__":/.test(b)) hasMain = true; else code(b); });
    if (hasMain) { md('## Train and evaluate'); code('main()'); }
    if (files.predict) {
      var pdoc = docOf(files.predict), p = noDoc(files.predict).replace(/^from train import .*\n/m, '');
      var hasFn = /\ndef main\(/.test('\n' + p);
      p = p.replace(/(^|\n)def main\(/, '$1def predict_new(');
      md('## Predict\n' + (pdoc ? pdoc.split('\n')[0] : 'Use the trained model.'));
      p.split(/\n{3,}/).forEach(function (b) { if (!/^\s*if __name__ == "__main__":/.test(b)) code(b); });
      if (!hasFn) code('main(DATA, "predictions.csv")');
      else if (spec.task === 'forecast') code('predict_new()');
      else code('from pathlib import Path\n\nif Path("new.csv").exists():\n    predict_new("new.csv")\nelse:\n    print("Put the rows to score in new.csv (same columns as ' + spec.file.replace(/"/g, '') + '), then run this cell again.")');
    }
    return JSON.stringify({ cells: cells, metadata: { kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' }, language_info: { name: 'python' } }, nbformat: 4, nbformat_minor: 5 }, null, 1) + '\n';
  };

  /* ------------------------------------------------------------------ dataset notation: D = {(t, g, x, y)} */
  RI.notation = function (spec) {
    var d = RI.derive(spec), parts = [], dims = [];
    if (d.time) parts.push('t_i');
    if (d.groups.length) parts.push('g_i');
    var nNum = d.num.length + d.bool.length, nCat = d.cat.length, nTxt = d.txt.length;
    if (nNum + nCat + nTxt + d.dates.length) parts.push('\\mathbf x_i');
    if (d.target || (spec.task !== 'cluster' && spec.task !== 'anomaly')) parts.push('y_i');
    if (nNum) dims.push('\\mathbb R^{' + nNum + '}');
    if (nCat) dims.push('\\mathcal C^{' + nCat + '}');
    if (nTxt) dims.push('\\Sigma^{*' + (nTxt > 1 ? nTxt : '') + '}');
    if (d.dates.length) dims.push('\\mathcal T^{' + d.dates.length + '}');
    var ySpace = spec.task === 'binary' ? '\\{0, 1\\}' : spec.task === 'multiclass' ? '\\{1, \\dots, K\\}' : '\\mathbb R';
    if (spec.task === 'cluster' || spec.task === 'anomaly') {
      var tu = '\\mathcal D = \\{(' + parts.join(', ') + ')\\}_{i=1}^{n}' + (dims.length ? ',\\quad \\mathbf x \\in ' + dims.join(' \\times ') : '');
      return tu + (spec.task === 'cluster' ? ',\\quad \\text{find } c: \\mathcal X \\to \\{1, \\dots, K\\}' : ',\\quad \\text{score } s(\\mathbf x_i),\\ \\text{flag the top } \\varepsilon');
    }
    var tex = '\\mathcal D = \\{(' + parts.join(', ') + ')\\}_{i=1}^{n}';
    if (dims.length) tex += ',\\quad \\mathbf x \\in ' + dims.join(' \\times ');
    tex += ',\\quad y \\in ' + ySpace;
    if (spec.task === 'forecast') tex += ',\\quad \\text{find } \\hat y_{T+1}, \\dots, \\hat y_{T+' + spec.horizon + '}';
    return tex;
  };

  /* ------------------------------------------------------------------ sample datasets for the Lab */
  RI.SAMPLES = [
    { key: 'bakery', name: 'Bakery, daily per shop', text: 'date,shop_id,temp_c,is_holiday,promo,footfall,loaves_sold\n2025-03-01,S01,11.5,false,true,412,188\n2025-03-01,S02,11.5,false,false,301,121\n2025-03-02,S01,9.0,false,false,380,160',
      tweak: function (c) { if (c.name === 'promo') c.key = true; }, task: 'forecast', freq: 'D', horizon: 14, rows: 'm' },
    { key: 'churn', name: 'Customer churn', text: 'customer_id,signup_date,plan,monthly_spend,support_tickets_90d,last_login_days,region,churned\nC-1001,2023-05-14,pro,49.0,0,2,EU,no\nC-1002,2024-01-02,basic,9.0,4,31,NA,yes',
      tweak: function (c) { if (c.name === 'support_tickets_90d' || c.name === 'plan') c.key = true; }, task: 'binary', rows: 's' },
    { key: 'rent', name: 'Apartment rents', text: 'listing_id\tcity\tsqm\trooms\tfloor\thas_balcony\tyear_built\tdescription\trent_eur\nL88\tLyon\t54\t2\t3\t1\t1972\tBright renovated flat near the river, quiet street\t1090\nL89\tNantes\t38\t1\t0\t0\t1995\tStudio with garden view and new kitchen\t720',
      tweak: function (c) { if (c.name === 'sqm' || c.name === 'city') c.key = true; }, task: 'regression', rows: 's' },
    { key: 'energy', name: 'Hourly grid load', text: 'timestamp,temp_c,is_workday,load_mw\n2025-01-06 00:00,-2.1,1,3412\n2025-01-06 01:00,-2.6,1,3290\n2025-01-06 02:00,-3.0,1,3204',
      tweak: function (c) { if (c.name === 'temp_c') c.key = true; }, task: 'forecast', freq: 'H', horizon: 48, rows: 'l' },
    { key: 'icecream', name: 'Monthly units', text: 'month,units\n2018-01-01,1204\n2018-02-01,1350\n2018-03-01,1802', task: 'forecast', freq: 'M', horizon: 12, rows: 'xs', intervals: true },
    { key: 'wine', name: 'Wine quality bands', text: 'fixed_acidity;volatile_acidity;citric_acid;residual_sugar;chlorides;sulphates;alcohol;quality_band\n7.4;0.70;0.00;1.9;0.076;0.56;9.4;low\n7.8;0.88;0.00;2.6;0.098;0.68;9.8;mid',
      tweak: function (c) { if (c.name === 'alcohol' || c.name === 'volatile_acidity') c.key = true; }, task: 'multiclass', rows: 's' },
    { key: 'fraud', name: 'Card transactions', text: 'txn_id,amount_eur,merchant_category,country,hour_of_day,km_from_home,card_present,is_fraud\nT-90211,42.50,grocery,FR,18,2.1,true,false\nT-90212,1890.00,electronics,NG,3,5210.4,false,true',
      tweak: function (c) { if (c.name === 'amount_eur' || c.name === 'km_from_home') { c.key = true; c.role = 'feature'; } if (c.name === 'is_fraud') c.role = 'target'; }, task: 'anomaly', rows: 'l' },
    { key: 'segments', name: 'Customer segments', text: 'customer_id,age,annual_income_k,visits_per_month,avg_basket_eur,channel,loyalty_member\nC-501,34,52,6,38.20,app,yes\nC-502,61,78,2,112.90,store,no',
      tweak: function (c) { if (c.role === 'target') c.role = 'feature'; if (c.name === 'avg_basket_eur' || c.name === 'visits_per_month') c.key = true; }, task: 'cluster', rows: 'm' },
    { key: 'latency', name: 'API latency monitor', text: 'timestamp,endpoint,p95_latency_ms\n2025-05-01 00:00,/search,182\n2025-05-01 00:00,/checkout,240\n2025-05-01 01:00,/search,175',
      tweak: function (c) { if (c.name === 'endpoint') { c.role = 'group'; c.type = 'categorical'; } }, task: 'anomaly', freq: 'H', rows: 'm' }
  ];
})();

/* ===== admin.html ===== */
(function () {
  var esc = UI.esc;
  var TABS = [['overview', 'Overview', 'grid'], ['feedback', 'Feedback', 'inbox'], ['users', 'Users', 'users'], ['commons', 'Commons', 'share'], ['demo', 'Demo data', 'database']];

  UI.page('admin', { title: 'Admin', auth: 'admin' }, function (view, ctx) {
    var tab = TABS.some(function (t) { return t[0] === ctx.args[0]; }) ? ctx.args[0] : 'overview';
    var fbFilter = 'new';
    view.innerHTML = '<div class="ui-wrap"><div class="ui-page-head"><div><h1>Admin</h1><p class="muted">Only admins see this page.</p></div></div>' +
      '<nav class="ui-tabs">' + TABS.map(function (t) {
        return '<a href="#admin/' + t[0] + '" class="' + (t[0] === tab ? 'on' : '') + '">' + UI.icon(t[2]) + t[1] + '</a>';
      }).join('') + '</nav><div data-body><div class="ui-skel"></div></div></div>';
    var body = view.querySelector('[data-body]');

    function overview() {
      return UI.api('admin_overview').then(function (d) {
        var stat = function (n, label, go) { return '<a class="ui-card ui-stat" href="#admin/' + go + '" style="text-decoration:none;color:inherit"><b>' + n + '</b><span>' + label + '</span></a>'; };
        body.innerHTML = '<div class="ad-stats">' + stat(d.users, 'people signed up', 'users') + stat(d.admins, UI.plural(d.admins, 'admin').replace(/^\d+ /, ''), 'users') +
          stat(d.feedback_new, 'new feedback', 'feedback') + stat(d.snippets, 'listings saved', 'overview') + stat(d.public, 'shared in the Commons', 'commons') +
          stat(d.datasets, 'data descriptions', 'overview') + '</div>' +
          '<p class="muted small" style="margin-top:18px">Demo data is <b>' + esc(d.demo.state) + '</b> (' + d.demo.counts.users + ' demo people). Manage it in the Demo data tab.</p>';
      });
    }

    function feedback() {
      return UI.api('list_feedback', null).then(function (d) {
        var items = d.items.filter(function (i) { return fbFilter === 'all' || i.status === fbFilter; });
        body.innerHTML = '<div class="ui-row" style="margin-bottom:16px"><div class="ui-seg">' + [['new', 'New'], ['read', 'Read'], ['done', 'Done'], ['all', 'All']].map(function (f) {
          var n = f[0] === 'all' ? d.items.length : d.counts[f[0]];
          return '<button data-filter="' + f[0] + '" class="' + (fbFilter === f[0] ? 'on' : '') + '">' + f[1] + ' (' + n + ')</button>';
        }).join('') + '</div></div>' +
          (items.length ? '<div class="ad-fb">' + items.map(function (i) {
            var c = i.context || {};
            return '<div class="ui-item" data-id="' + esc(i.id) + '"><div class="meta"><span class="ui-badge ' + (i.kind === 'bug' ? 'bad' : i.kind === 'idea' ? 'brand' : '') + '">' + esc(i.kind_label) + '</span>' +
              '<b>' + esc(i.name) + '</b>' + (i.email ? '<a href="mailto:' + esc(i.email) + '">' + esc(i.email) + '</a>' : '') + '<span>' + esc(UI.fmtDateTime(i.created)) + '</span></div>' +
              '<p class="msg">' + esc(i.message) + '</p>' +
              '<div class="ctx">' + esc([c.page, c.screen, c.theme, c.browser].filter(Boolean).join(' · ')) + '</div>' +
              '<textarea data-note placeholder="Private note (only admins see it)">' + esc(i.note) + '</textarea>' +
              '<div class="ui-row" style="margin-top:10px">' + ['new', 'read', 'done'].map(function (s) {
                return '<button class="ui-btn sm' + (i.status === s ? ' primary' : '') + '" data-status="' + s + '">' + s[0].toUpperCase() + s.slice(1) + '</button>';
              }).join('') + '<span class="ui-spacer"></span><button class="ui-btn sm danger" data-del-fb>' + UI.icon('trash') + 'Delete</button></div></div>';
          }).join('') + '</div>'
            : '<div class="ui-empty">' + UI.icon('inbox') + '<h3>No ' + (fbFilter === 'all' ? '' : fbFilter + ' ') + 'messages</h3><p>Messages from the "Send feedback" form show up here.</p></div>');
      });
    }

    function users(query) {
      return UI.api('list_users', query || null).then(function (d) {
        body.innerHTML = '<form class="ui-row" data-search style="margin-bottom:14px"><input type="search" name="q" placeholder="Search by name or email" value="' + esc(query || '') + '" style="max-width:360px">' +
          '<button class="ui-btn" type="submit">' + UI.icon('search') + 'Search</button><span class="muted small">' + UI.plural(d.total, 'person', 'people') + '</span></form>' +
          '<table class="ad-users"><thead><tr><th>Name</th><th>Email</th><th>Joined</th><th>Admin</th><th>Active</th></tr></thead><tbody>' +
          d.users.map(function (u) {
            return '<tr data-id="' + esc(u.id) + '"><td><b>' + esc(u.name) + '</b></td><td class="email">' + esc(u.email) + '</td><td class="joined muted">' + esc(UI.fmtDate(u.joined)) + '</td>' +
              '<td><label class="ui-check"><input type="checkbox" data-admin' + (u.is_admin ? ' checked' : '') + '> Admin</label></td>' +
              '<td><label class="ui-check"><input type="checkbox" data-enabled' + (u.enabled ? ' checked' : '') + '> Active</label></td></tr>';
          }).join('') + '</tbody></table>';
      });
    }

    function demo() {
      return UI.api('admin_overview').then(function (d) {
        var c = d.demo.counts;
        body.innerHTML = '<div class="ui-card ui-narrow" style="margin:0"><h3>Demo data</h3>' +
          '<p class="muted">Example people and content, so the app never looks empty for the first visitors. Demo rows are flagged, so removing them never touches real data. Once removed, it stays removed until you load it again.</p>' +
          '<p>Status: <b>' + esc(d.demo.state) + '</b> · ' + Object.keys(c).map(function (k) { return c[k] + ' ' + esc(k); }).join(', ') + '</p>' +
          '<div class="ui-row"><button class="ui-btn primary" data-demo="load">' + UI.icon('refresh') + (d.demo.state === 'loaded' ? 'Reload demo data' : 'Load demo data') + '</button>' +
          '<button class="ui-btn danger" data-demo="remove">' + UI.icon('trash') + 'Remove demo data</button></div></div>';
      });
    }

    function commons() {
      return UI.api('admin_commons').then(function (d) {
        body.innerHTML = '<p class="muted small">Every public listing. Unpublishing makes it private again (the author keeps it); deleting removes it for good.</p>' +
          (d.items.length ? '<div class="ad-fb">' + d.items.map(function (s) {
            return '<div class="ui-item" data-sid="' + esc(s.id) + '"><div class="meta"><span class="ui-badge">' + esc((RI.MODEL[s.model] || { name: s.model }).name) + '</span>' +
              (s.demo ? '<span class="ui-badge">demo</span>' : '') + '<b>' + esc(s.author) + '</b><span>' + esc(UI.fmtDateTime(s.updated)) + '</span><span>cited ' + s.cites + '×</span></div>' +
              '<p class="msg"><a href="#snippet/' + esc(s.id) + '">' + esc(s.title) + '</a></p>' + (s.notes ? '<div class="ctx">' + esc(s.notes) + '</div>' : '') +
              '<div class="ui-row"><button class="ui-btn sm" data-unpub>' + UI.icon('lock') + 'Unpublish</button><span class="ui-spacer"></span><button class="ui-btn sm danger" data-del-snip>' + UI.icon('trash') + 'Delete</button></div></div>';
          }).join('') + '</div>' : '<div class="ui-empty">' + UI.icon('share') + '<h3>Nothing is shared yet</h3></div>');
      });
    }

    var DRAW = { overview: overview, feedback: feedback, users: users, commons: commons, demo: demo };

    view.addEventListener('click', function (e) {
      var f = e.target.closest('[data-filter]');
      if (f) { fbFilter = f.getAttribute('data-filter'); feedback(); return; }
      var st = e.target.closest('[data-status]');
      if (st) {
        var card = st.closest('[data-id]');
        UI.api('set_feedback_status', card.getAttribute('data-id'), st.getAttribute('data-status'), card.querySelector('[data-note]').value).then(function () { UI.toast('Saved', 'ok'); feedback(); });
        return;
      }
      var del = e.target.closest('[data-del-fb]');
      if (del) {
        UI.confirm({ title: 'Delete this message?', ok: 'Delete', danger: true }).then(function (yes) {
          if (yes) UI.api('delete_feedback', del.closest('[data-id]').getAttribute('data-id')).then(feedback);
        });
        return;
      }
      var sn = e.target.closest('[data-sid]');
      if (sn && e.target.closest('[data-unpub]')) { UI.api('admin_unpublish', sn.getAttribute('data-sid')).then(function () { UI.toast('Unpublished', 'ok'); commons(); }); return; }
      if (sn && e.target.closest('[data-del-snip]')) {
        UI.confirm({ title: 'Delete this listing?', text: 'It is removed from its author’s notebook too.', ok: 'Delete', danger: true })
          .then(function (yes) { if (yes) UI.api('delete_snippet', sn.getAttribute('data-sid')).then(commons); });
        return;
      }
      var dm = e.target.closest('[data-demo]');
      if (dm) {
        var load = dm.getAttribute('data-demo') === 'load';
        UI.confirm({ title: load ? 'Load the demo data?' : 'Remove the demo data?', text: load ? 'Demo people and content are added (any old demo rows are replaced).' : 'Every demo row is deleted. Real data stays.', ok: load ? 'Load' : 'Remove', danger: !load })
          .then(function (yes) { if (yes) UI.busy(dm, UI.api(load ? 'demo_load' : 'demo_remove')).then(function () { UI.toast('Done', 'ok'); demo(); }); });
      }
    });
    view.addEventListener('change', function (e) {
      var row = e.target.closest('tr[data-id]');
      if (!row) return;
      var id = row.getAttribute('data-id'), box = e.target;
      var fn = box.hasAttribute('data-admin') ? 'set_admin' : box.hasAttribute('data-enabled') ? 'set_enabled' : null;
      if (fn) UI.api(fn, id, box.checked).then(function () { UI.toast('Saved', 'ok'); }, function (err) { box.checked = !box.checked; UI.toast(err.message, 'error'); });
    });
    view.addEventListener('submit', function (e) {
      if (e.target.matches('[data-search]')) { e.preventDefault(); users(UI.formData(e.target).q); }
    });
    return DRAW[tab]();
  });
})();

/* ===== atlas.html ===== */
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
      (m.related.length ? '<div class="ui-card"><h4>Related</h4><div class="ui-stack" style="font-size:.95rem">' + m.related.map(function (s) { var r = RI.MODEL[s]; return r ? '<div><a href="#atlas/model/' + s + '">' + esc(r.name) + '</a></div>' : ''; }).join('') + '</div></div>' : '') +
      '</aside></div></div>';
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
      view.innerHTML = '<div class="ui-wrap"><div class="at-head"><div><div class="eyebrow">§ The Atlas</div><h1>Every strategy, with the maths</h1>' +
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

/* ===== auth.html ===== */
(function () {
  var esc = UI.esc;
  function pw(name, auto) {
    return '<div class="au-pw"><input type="password" name="' + name + '" autocomplete="' + auto + '" required minlength="8">' +
      '<button type="button" data-show>Show</button></div>';
  }
  UI.page('auth', { title: 'Sign in', auth: 'guest' }, function (view, ctx) {
    var mode = ['signup', 'reset'].indexOf(ctx.args[0]) >= 0 ? ctx.args[0] : 'login';
    function draw(msg, isErr) {
      var heading = { login: 'Welcome back', signup: 'Create your account', reset: 'Reset your password' }[mode];
      var sub = { login: 'Sign in to continue to ' + esc(UI.config.name) + '.', signup: 'It\'s free and takes a few seconds.',
        reset: 'We\'ll email you a link to choose a new password.' }[mode];
      view.innerHTML = '<div class="au-wrap"><div class="ui-card au-card">' +
        '<h1>' + heading + '</h1><p class="muted">' + sub + '</p>' +
        (mode !== 'reset' ? '<div class="ui-seg" role="tablist"><button type="button" data-mode="login" class="' + (mode === 'login' ? 'on' : '') + '">Sign in</button>' +
          '<button type="button" data-mode="signup" class="' + (mode === 'signup' ? 'on' : '') + '">Create account</button></div>' : '<div style="height:14px"></div>') +
        '<form class="ui-stack" data-form="' + mode + '" novalidate>' +
        (mode === 'signup' ? '<label class="ui-field"><span>Your name</span><input type="text" name="name" autocomplete="name" required maxlength="60"></label>' : '') +
        '<label class="ui-field"><span>Email</span><input type="email" name="email" autocomplete="email" required></label>' +
        (mode === 'login' ? '<label class="ui-field"><span>Password</span>' + pw('password', 'current-password') + '</label>' : '') +
        (mode === 'signup' ? '<label class="ui-field"><span>Password <em>(at least 8 characters)</em></span>' + pw('password', 'new-password') + '</label>' +
          (window.LegalKit ? '<div>' + LegalKit.consentField() + '</div>' : '') : '') +
        '<div data-msg role="alert"' + (msg ? ' class="' + (isErr ? 'ui-error' : 'ui-note') + '">' + esc(msg) : ' hidden>') + '</div>' +
        '<button class="ui-btn primary block" type="submit">' + { login: 'Sign in', signup: 'Create account', reset: 'Send the link' }[mode] + '</button></form>' +
        '<div class="au-links">' + (mode === 'login' ? '<a data-mode="reset">Forgot your password?</a>' : '<a data-mode="login">' + UI.icon('back') + ' Back to sign in</a>') +
        '<a href="#landing" data-go="landing">About ' + esc(UI.config.name) + '</a></div></div></div>';
      var first = view.querySelector('input');
      if (first && !msg) first.focus();
    }
    view.addEventListener('click', function (e) {
      var m = e.target.closest('[data-mode]');
      if (m) { e.preventDefault(); mode = m.getAttribute('data-mode'); history.replaceState(null, '', '#auth' + (mode === 'login' ? '' : '/' + mode)); draw(); return; }
      var s = e.target.closest('[data-show]');
      if (s) { var i = s.parentNode.querySelector('input'); i.type = i.type === 'password' ? 'text' : 'password'; s.textContent = i.type === 'password' ? 'Show' : 'Hide'; }
    });
    view.addEventListener('submit', function (e) {
      e.preventDefault();
      var form = e.target, v = UI.formData(form);
      var problem = !/^\S+@\S+\.\S+$/.test(v.email || '') ? 'Please enter a valid email address.'
        : mode !== 'reset' && (v.password || '').length < (mode === 'signup' ? 8 : 1) ? (mode === 'signup' ? 'Please choose a password of at least 8 characters.' : 'Please enter your password.')
        : mode === 'signup' && (v.name || '').trim().length < 2 ? 'Please tell us your name.' : null;
      if (problem) { say(problem, true); return; }
      if (mode === 'signup' && window.LegalKit && !LegalKit.consentChecked(form)) return;  // the kit shows its own message
      UI.busy(form.querySelector('[type=submit]'), UI.auth(mode, v)).then(function (r) {
        if (mode === 'reset' || (r && !r.me)) { mode = 'login'; draw(r && r.message, false); restore({ email: v.email }); }
        else UI.toast(mode === 'signup' ? 'Welcome to ' + UI.config.name + '!' : 'Welcome back!', 'ok');
      }, function (err) { say(err.message, true); });
    });
    function say(msg, isErr) {
      var box = view.querySelector('[data-msg]');
      box.className = isErr ? 'ui-error' : 'ui-note'; box.textContent = msg; box.hidden = false;
    }
    function restore(v) {
      ['name', 'email'].forEach(function (k) { var i = view.querySelector('[name=' + k + ']'); if (i && v[k]) i.value = v[k]; });
    }
    draw();
  });
})();

/* ===== commons.html ===== */
(function () {
  var esc = UI.esc;
  UI.page('commons', { title: 'The Commons', nav: 'Commons', icon: 'users', order: 40 }, function (view, ctx) {
    var q = '', model = '', task = '', sort = 'new', timer = null, first = true;
    view.innerHTML = '<div class="ui-wrap"><div class="ui-page-head"><div><div class="eyebrow">§ The Commons</div><h1>Listings people shared</h1>' +
      '<p class="muted">Real data descriptions with the code RoboIntern wrote for them. Fork one into your notebook, or open it in the Lab and make it yours.</p></div></div>' +
      '<div class="cm-tools"><input type="search" data-q placeholder="search titles, notes, tags…" aria-label="Search the Commons">' +
      '<div class="ui-seg" data-tasks></div><select data-model aria-label="Model"></select>' +
      '<div class="ui-seg"><button type="button" data-sort="new" class="on">Newest</button><button type="button" data-sort="cited">Most cited</button></div></div>' +
      '<div data-list><div class="ui-skel" style="height:240px"></div></div></div>';
    var list = view.querySelector('[data-list]');
    function load() {
      return UI.apiQuiet('list_commons', q || null, model || null, task || null, sort).then(function (d) {
        if (first) {
          first = false;
          view.querySelector('[data-model]').innerHTML = '<option value="">All models</option>' + Object.keys(d.models).sort().map(function (k) {
            return '<option value="' + esc(k) + '">' + esc((RI.MODEL[k] || { name: k }).name) + ' (' + d.models[k] + ')</option>'; }).join('');
          view.querySelector('[data-tasks]').innerHTML = '<button type="button" data-task="" class="on">All</button>' + Object.keys(RI.TASKS).filter(function (t) { return d.tasks[t]; }).map(function (t) {
            return '<button type="button" data-task="' + t + '">' + esc(RI.TASK_SHORT[t] || t) + '</button>'; }).join('');
        }
        list.innerHTML = d.items.length ? '<p class="small muted">' + UI.plural(d.total, 'listing') + '</p><div class="cm-grid">' + d.items.map(function (s) {
          var m = RI.MODEL[s.model] || { name: s.model };
          return '<a class="ui-card ri-card-link cm-card" href="#snippet/' + esc(s.id) + '"><div class="ri-meta"><span>' + esc(m.name) + '</span><span>' + esc(RI.TASKS[s.task] || s.task) + '</span>' + (s.target ? '<span>y = ' + esc(s.target) + '</span>' : '') + '</div>' +
            '<h3>' + esc(s.title) + '</h3>' + (s.notes ? '<p>' + esc(s.notes) + '</p>' : '') +
            '<div class="ri-meta">' + s.tags.map(function (t) { return '<span>#' + esc(t) + '</span>'; }).join('') + '</div>' +
            '<div class="cm-foot"><span>' + esc(s.author) + ' · ' + esc(UI.ago(s.updated)) + '</span><span class="cm-cite">' + (s.cites ? 'cited ' + s.cites + '×' : s.ncols + ' cols') + '</span></div></a>';
        }).join('') + '</div>'
          : '<div class="ui-empty">' + UI.icon('users') + '<h3>' + (q || model || task ? 'Nothing matches' : 'Nothing shared yet') + '</h3><p>Save a listing from the Lab and tick “Share in the Commons”.</p>' +
            '<a class="ui-btn" href="#lab" data-go="lab">' + UI.icon('flask') + 'Open the Lab</a></div>';
      });
    }
    view.addEventListener('input', function (e) {
      if (e.target.matches('[data-q]')) { q = e.target.value; clearTimeout(timer); timer = setTimeout(load, 250); }
    });
    view.addEventListener('change', function (e) { if (e.target.matches('[data-model]')) { model = e.target.value; load(); } });
    view.addEventListener('click', function (e) {
      var t = e.target.closest('[data-sort],[data-task]');
      if (!t) return;
      var seg = t.parentNode;
      seg.querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b === t); });
      if (t.hasAttribute('data-sort')) sort = t.getAttribute('data-sort'); else task = t.getAttribute('data-task');
      load();
    });
    return { ready: load(), destroy: function () { clearTimeout(timer); } };
  });
})();

/* ===== lab.html ===== */
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
    view.innerHTML = '<div class="ui-wrap"><header class="lb-head"><div class="eyebrow">§ The Lab</div>' +
      '<h1>Describe your data. <em>Get the model, and the code.</em></h1>' +
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
    function saveSnippet() {
      if (!ctx.me) return needAccount('this listing');
      var m = RI.MODEL[st.pick], d = RI.derive(spec());
      var dlg = UI.modal('<h2>Save to your notebook</h2><p class="muted">The listing keeps its data description, so you can reopen it in the Lab later. Only column names, types and roles are stored, never your data.</p>' +
        '<form class="ui-stack" data-sv><label class="ui-field"><span>Title</span><input type="text" name="title" maxlength="120" required value="' + esc(m.name + ' · ' + (d.target || RI.TASK_SHORT[spec().task].toLowerCase())) + '"></label>' +
        '<label class="ui-field"><span>Notes <em>(optional)</em></span><textarea name="notes" maxlength="4000" placeholder="What this is for, what you changed, results…"></textarea></label>' +
        '<label class="ui-field"><span>Tags <em>(comma-separated, optional)</em></span><input type="text" name="tags" maxlength="200" placeholder="retail, daily"></label>' +
        '<label class="ui-check"><input type="checkbox" name="is_public"><span>Share it in the Commons (others see the title, notes, columns and code, with your name)</span></label>' +
        '<div class="ui-row end"><button type="button" class="ui-btn ghost" data-close>Cancel</button><button class="ui-btn primary" type="submit">' + UI.icon('save') + 'Save</button></div></form>');
      var form = dlg.el.querySelector('[data-sv]');
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var v = UI.formData(form);
        var data = { title: v.title, model: st.pick, spec: spec(), files: files, notes: v.notes, tags: (v.tags || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean), is_public: v.is_public };
        UI.busy(form.querySelector('[type=submit]'), UI.api('save_snippet', null, data)).then(function (r) {
          dlg.close();
          UI.toast('Saved to your notebook', 'ok');
          UI.confirm({ title: 'Saved', text: 'Open the listing now, or keep working in the Lab?', ok: 'Open listing', cancel: 'Stay here' }).then(function (yes) { if (yes) UI.go('snippet', r.snippet.id); });
        });
      });
    }
    function saveDataset() {
      var cur = datasets && st.dataset ? datasets.filter(function (d) { return d.id === st.dataset; })[0] : null;
      var dlg = UI.modal('<h2>Save the data description</h2><p class="muted">Column names, types, roles and task settings. No values.</p>' +
        '<form class="ui-stack" data-sd><label class="ui-field"><span>Name</span><input type="text" name="name" maxlength="80" required value="' + esc(cur ? cur.name : (RI.derive(spec()).target || 'My') + ' data') + '"></label>' +
        (cur ? '<label class="ui-check"><input type="checkbox" name="overwrite" checked><span>Update “' + esc(cur.name) + '” (untick to save a new one)</span></label>' : '') +
        '<div class="ui-row end"><button type="button" class="ui-btn ghost" data-close>Cancel</button><button class="ui-btn primary" type="submit">Save</button></div></form>');
      var form = dlg.el.querySelector('[data-sd]');
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var v = UI.formData(form);
        UI.busy(form.querySelector('[type=submit]'), UI.api('save_dataset', cur && v.overwrite ? cur.id : null, v.name, spec())).then(function (r) {
          dlg.close(); st.dataset = r.dataset.id; save(); UI.toast('Data description saved', 'ok'); loadDatasets();
        });
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

/* ===== landing.html ===== */
(function () {
  var COPY = {
    eyebrow: 'A field guide to predictive models',
    title: 'Describe your data.<br><em>Get the model, and the Python.</em>',
    lead: 'Paste your table\u2019s header row and mark what matters: the target, the time column, the drivers you trust. RoboIntern ranks the machine-learning models that fit, explains the maths behind each one, and writes train.py and predict.py for you to run.',
    cta: 'Start in the Lab',
    proof: [RI.MODELS.length + ' models, from seasonal na\u00efve to foundation models', 'Leakage-aware forecasting code', 'Your data never leaves the browser'],
    stepsTitle: 'How it works',
    stepsLead: 'No uploads, no notebooks to configure. Lists in, code out.',
    steps: [['Paste the header', 'A header row, or a few rows of your CSV or spreadsheet. Types and roles are guessed: date \u2192 time t, sales \u2192 target y.'],
            ['Mark what matters', 'One click per column for its role, a \u2605 for your key drivers, a tick for drivers you know in advance. Drag a point on a simplex to trade accuracy, interpretability and speed.'],
            ['Run the code', 'Pick from the ranked models and copy train.py, predict.py and requirements.txt. They load your CSV, build the features, validate honestly, and save a model you can use.']],
    featuresTitle: 'What\u2019s inside',
    features: [['flask', 'The Lab', 'A recommender with a visible scoring formula: you see exactly why LightGBM beats ARIMA for your data, and when it doesn\u2019t.'],
               ['book', 'The Atlas', 'Every model with its definition, objective, intuition, assumptions, hyperparameters and complexity, typeset properly.'],
               ['sliders', 'Feature development', 'Lags, rolling windows, Fourier terms, target encoding, known-ahead vs. past-only drivers, each with the leakage trap it avoids.'],
               ['grid', 'Validation & metrics', 'Expanding windows, purged splits, MASE, pinball loss, coverage, with fold diagrams.'],
               ['notebook', 'Your notebook', 'Save listings and data descriptions, edit the code, star the good ones, and reopen any of them in the Lab.'],
               ['users', 'The Commons', 'Share a listing and fork other people\u2019s. Forks count as citations, as they should.']],
    faq: [['Does RoboIntern run my data or train anything?', 'No. It\u2019s a lookup dictionary with a code writer. Parsing happens in your browser; you run the Python on your own machine, where your data already is.'],
          ['What do you store?', 'Only what you save: listing titles, notes, the code, and the column names, types and roles of your data description. Never the values in your table.'],
          ['Which libraries does the code use?', 'pandas and scikit-learn throughout, plus XGBoost, LightGBM, CatBoost, statsmodels, Prophet or PyTorch when the model needs them. requirements.txt lists exactly what to install.'],
          ['Is the generated code any good?', 'It is careful where it counts: time-ordered splits, a seasonal-na\u00efve benchmark, MASE, lags that never peek at the future, conformal intervals and permutation importance. Every model\u2019s listing is run end to end on test data before release. It is still a starting point: read it and tune it.'],
          ['Is it free?', 'Yes. The Atlas, the Lab and the code are free without an account. A free account adds your notebook and the Commons.']],
    bandTitle: 'Your intern is ready.',
    bandLead: 'Paste a header row and see what it suggests. No sign-up needed.'
  };

  function heroArt() {
    var col = function (role, g, name, key) { return '<div class="' + (key ? 'k' : '') + '"><span class="ri-role ' + role + '">' + g + '</span><br><span class="n">' + name + '</span>' + (key ? ' \u2605' : '') + '</div>'; };
    var rk = function (n, name, s, on) { return '<div class="' + (on ? 'on' : '') + '"><span class="r">' + n + '</span><span>' + name + '</span><span class="s">' + s + '</span><span></span><i><b style="width:' + s + '%"></b></i></div>'; };
    return '<div class="lp-art" aria-hidden="true"><div class="lp-eq ri-tex" data-hero-eq></div><div class="lp-paper">' +
      '<div class="lp-cap"><span>Figure 1. sales.csv, described</span><span>\u00a71\u2013\u00a75</span></div>' +
      '<div class="lp-cols">' + col('time', 't', 'date') + col('group', 'g', 'store') + col('feature', 'x<sub>1</sub>', 'promo', true) + col('feature', 'x<sub>2</sub>', 'temp') + col('target', 'y', 'sales') + '</div>' +
      '<div class="lp-arrow">\u27f9 ranked for your data</div>' +
      '<div class="lp-rank">' + rk(1, 'LightGBM', '81.4', true) + rk(2, 'CatBoost', '78.9') + rk(3, 'SARIMAX', '64.2') + rk(4, 'Seasonal na\u00efve', '41.0') + '</div>' +
      '<div class="lp-code"><span class="k">def</span> add_features(df):\n    <span class="k">for</span> k <span class="k">in</span> LAGS:  <span class="c"># 1, 7, 14, 28</span>\n        df[<span class="s">f"lag_{k}"</span>] = g[TARGET].shift(k)\n    df[<span class="s">"promo_delta"</span>] = df.promo - g.promo.shift(<span class="n">1</span>)</div>' +
      '</div></div>';
  }
  var STRIP = ['lgbm', 'arima', 'gp'];
  function mathStrip() {
    return '<div class="lp-math">' + STRIP.map(function (s) {
      var m = RI.MODEL[s];
      return '<a class="ui-card" href="#atlas/model/' + s + '"><div class="ri-tex">' + RI.tex(m.eq, false) + '</div><h3>' + UI.esc(m.name) + '</h3><p>' + UI.esc(m.summary) + '</p></a>';
    }).join('') + '</div>';
  }

  UI.page('landing', { title: 'A field guide to predictive models' }, function (view, ctx) {
    var me = ctx.me, C = COPY, esc = UI.esc;
    var primary = '<a class="ui-btn primary lg" href="#lab" data-go="lab">' + esc(C.cta) + ' ' + UI.icon('arrow') + '</a>' +
      '<a class="ui-btn lg" href="#atlas" data-go="atlas">' + UI.icon('book') + 'Browse the Atlas</a>';
    view.innerHTML =
      '<section class="lp-hero"><div class="ui-wrap"><div>' +
        '<div class="eyebrow">' + esc(C.eyebrow) + '</div><h1>' + C.title + '</h1><p class="lp-lead">' + esc(C.lead) + '</p>' +
        '<div class="lp-cta">' + primary + '</div>' +
        '<div class="lp-proof">' + C.proof.map(function (p) { return '<span>' + UI.icon('check') + esc(p) + '</span>'; }).join('') + '</div>' +
      '</div>' + heroArt() + '</div></section>' +
      '<section class="lp-section" id="how"><div class="ui-wrap"><div class="lp-head"><h2>' + esc(C.stepsTitle) + '</h2><p>' + esc(C.stepsLead) + '</p></div>' +
        '<div class="lp-steps">' + C.steps.map(function (s) { return '<div class="ui-card lp-step"><h3>' + esc(s[0]) + '</h3><p class="muted">' + esc(s[1]) + '</p></div>'; }).join('') + '</div></div></section>' +
      '<section class="lp-section"><div class="ui-wrap"><div class="lp-head"><h2>' + esc(C.featuresTitle) + '</h2></div>' +
        '<div class="ui-grid">' + C.features.map(function (f) { return '<div class="ui-card lp-feature">' + UI.icon(f[0]) + '<h3>' + esc(f[1]) + '</h3><p>' + esc(f[2]) + '</p></div>'; }).join('') + '</div></div></section>' +
      '<section class="lp-section"><div class="ui-wrap"><div class="lp-head"><h2>Typeset, not hand-waved</h2><p>Every entry in the Atlas states its model, its objective and its assumptions.</p></div>' + mathStrip() +
        '<p style="text-align:center;margin-top:18px"><a class="ui-btn" href="#atlas" data-go="atlas">All ' + RI.MODELS.length + ' models ' + UI.icon('arrow') + '</a></p></div></section>' +
      '<section class="lp-section"><div class="ui-wrap"><div class="lp-head"><h2>Questions</h2></div><div class="lp-faq">' +
        C.faq.map(function (q) { return '<details><summary>' + esc(q[0]) + '</summary><p>' + esc(q[1]) + '</p></details>'; }).join('') + '</div></div></section>' +
      '<section class="lp-section"><div class="ui-wrap"><div class="lp-band"><div><h2>' + esc(C.bandTitle) + '</h2><p>' + esc(C.bandLead) + '</p></div>' +
        '<a class="ui-btn lg" href="#lab" data-go="lab">' + esc(C.cta) + '</a>' +
      '</div></div></section>';
    var eq = function () {
      var el = view.querySelector('[data-hero-eq]');
      if (el) el.innerHTML = RI.tex('\\hat y_{T+h} = f\\big(y_{\\le T},\\ \\mathbf x^{\\text{known}}_{\\le T+h}\\big)', false);
      view.querySelectorAll('.lp-math .ri-tex').forEach(function (box, i) { box.innerHTML = RI.tex(RI.MODEL[STRIP[i]].eq, false); });
    };
    eq();
    RI.whenTex(eq);
  });
})();

/* ===== notebook.html ===== */
(function () {
  var esc = UI.esc;
  function lemma() {
    var day = Math.floor(Date.now() / 86400000), m = RI.MODELS[day % RI.MODELS.length];
    return '<div class="ui-card nb-lemma"><div class="eyebrow">Lemma of the day</div><h3><a href="#atlas/model/' + m.slug + '">' + esc(m.name) + '</a></h3>' +
      '<div class="ri-tex">' + RI.tex(m.eq, true) + '</div><p class="muted">' + RI.mtext(m.intuition) + '</p></div>';
  }
  function startCards() {
    return '<div class="nb-start">' + RI.SAMPLES.map(function (s) {
      return '<button type="button" data-start="' + s.key + '"><b>' + esc(s.name) + '</b><span>' + esc(s.text.split('\n')[0].replace(/[\t;,]/g, ', ').slice(0, 60)) + '…</span></button>';
    }).join('') + '</div>';
  }
  function item(s) {
    var m = RI.MODEL[s.model];
    return '<article class="ui-card nb-item" data-id="' + esc(s.id) + '"><div><div class="ri-meta"><span class="ri-listing-no">Listing ' + s.no + '</span>' +
      '<span>' + esc(m ? m.name : s.model) + '</span><span>' + esc(RI.TASKS[s.task] || s.task) + '</span>' + (s.target ? '<span>y = ' + esc(s.target) + '</span>' : '') +
      (s.is_public ? '<span class="ui-badge good">public' + (s.cites ? ' · cited ' + s.cites + '×' : '') + '</span>' : '') + (s.forked ? '<span class="ui-badge">fork</span>' : '') + '</div>' +
      '<h3><a href="#snippet/' + esc(s.id) + '">' + esc(s.title) + '</a></h3>' + (s.notes ? '<p>' + esc(s.notes) + '</p>' : '') +
      '<div class="ri-meta" style="margin-top:8px">' + s.tags.map(function (t) { return '<span>#' + esc(t) + '</span>'; }).join('') + '<span>edited ' + esc(UI.ago(s.updated)) + '</span></div></div>' +
      '<div class="acts"><button class="nb-star' + (s.starred ? ' on' : '') + '" data-star aria-label="' + (s.starred ? 'Unstar' : 'Star') + '" aria-pressed="' + s.starred + '">★</button></div></article>';
  }

  UI.page('notebook', { title: 'Notebook', nav: 'Notebook', icon: 'notebook', auth: 'user', order: 30 }, function (view, ctx) {
    var data = null, q = '', filter = 'all';
    view.innerHTML = '<div class="ui-wrap"><div class="ui-skel" style="height:260px"></div></div>';
    function draw() {
      var st = data.stats, first = ctx.me.name.split(' ')[0];
      var list = data.snippets.filter(function (s) {
        if (filter === 'starred' && !s.starred) return false;
        if (filter === 'public' && !s.is_public) return false;
        var hay = [s.title, s.notes, s.model, s.target || '', s.tags.join(' '), (RI.MODEL[s.model] || {}).name || ''].join(' ').toLowerCase();
        return !q || hay.indexOf(q.toLowerCase()) >= 0;
      }).sort(function (a, b) { return (b.starred - a.starred) || (a.updated < b.updated ? 1 : -1); });
      view.innerHTML = '<div class="ui-wrap"><div class="nb-head"><div><div class="eyebrow">§ Notebook</div><h1>' + esc(first) + '’s notebook</h1>' +
        '<div class="nb-stats ri-tex">' + RI.tex('|\\mathcal L| = ' + st.snippets + ',\\quad |\\mathcal D| = ' + st.datasets + ',\\quad |\\{m\\}| = ' + st.models + ',\\quad \\textstyle\\sum \\text{citations} = ' + st.cited, false) + '</div></div>' +
        '<a class="ui-btn primary" href="#lab" data-go="lab">' + UI.icon('flask') + 'New in the Lab</a></div>' +
        '<div class="nb-grid"><div>' +
        (data.snippets.length ? '<div class="nb-tools"><input type="search" data-q placeholder="search listings…" value="' + esc(q) + '" aria-label="Search your listings">' +
          '<div class="ui-seg">' + [['all', 'All'], ['starred', '★ Starred'], ['public', 'Public']].map(function (f) { return '<button type="button" data-filter="' + f[0] + '" class="' + (filter === f[0] ? 'on' : '') + '">' + f[1] + '</button>'; }).join('') + '</div></div>' +
          (list.length ? '<div class="nb-list">' + list.map(item).join('') + '</div>' : '<div class="ui-empty">' + UI.icon('search') + '<h3>No listing matches</h3></div>')
          : '<div class="ui-empty" style="text-align:left;padding:28px">' + UI.icon('notebook') + '<h3>Your notebook is empty, for now</h3>' +
            '<p class="muted">Describe a dataset in the Lab and save the code it writes: it lands here, ready to copy, edit, or share. Pick a sample to see how it works:</p>' + startCards() +
            '<p class="small muted" style="margin-top:16px">Or browse what others shared in the <a href="#commons">Commons</a>.</p></div>') +
        '</div><aside class="ui-stack">' + lemma() +
        '<div class="ui-card"><h3 style="font-size:1.05rem">Data descriptions</h3>' +
        (data.datasets.length ? '<div class="nb-ds">' + data.datasets.map(function (d) {
          return '<div class="ui-item" data-ds="' + esc(d.id) + '"><div class="grow"><h3>' + esc(d.name) + '</h3><p class="small muted">' + d.ncols + ' columns' + (d.target ? ' · y = ' + esc(d.target) : '') + ' · ' + esc(RI.TASKS[d.spec.task] || '') + '</p></div>' +
            '<button class="ui-btn sm" data-open-ds title="Open in the Lab">' + UI.icon('flask') + '</button><button class="ui-btn sm ghost danger" data-del-ds aria-label="Delete">' + UI.icon('trash') + '</button></div>';
        }).join('') + '</div>' : '<p class="muted small" style="margin:0">Save a description from the Lab (§1) to reuse your columns and roles.</p>') + '</div></aside></div></div>';
    }
    function load() { return UI.api('get_notebook').then(function (d) { data = d; draw(); }); }
    function startSample(key) {
      var s = RI.SAMPLES.filter(function (x) { return x.key === key; })[0];
      var p = RI.parse(s.text);
      p.columns.forEach(function (c) { if (s.tweak) s.tweak(c); });
      UI.store.set('lab-load', { text: s.text, spec: { columns: p.columns, task: s.task, freq: s.freq, horizon: s.horizon, rows: s.rows, intervals: s.intervals, weights: { acc: 0.5, interp: 0.25, speed: 0.25 }, file: s.key + '.csv', missing: false } });
      UI.go('lab');
    }
    view.addEventListener('input', function (e) {
      if (e.target.matches('[data-q]')) { q = e.target.value; draw(); var i = view.querySelector('[data-q]'); i.focus(); i.setSelectionRange(q.length, q.length); }
    });
    view.addEventListener('click', function (e) {
      var t;
      if ((t = e.target.closest('[data-filter]'))) { filter = t.getAttribute('data-filter'); draw(); return; }
      if ((t = e.target.closest('[data-start]'))) { startSample(t.getAttribute('data-start')); return; }
      if ((t = e.target.closest('[data-star]'))) {
        var id = t.closest('[data-id]').getAttribute('data-id'), s = data.snippets.filter(function (x) { return x.id === id; })[0];
        s.starred = !s.starred; draw();
        UI.apiQuiet('save_snippet', id, { starred: s.starred }).catch(function (err) { s.starred = !s.starred; draw(); UI.toast(err.message, 'error'); });
        return;
      }
      var ds = e.target.closest('[data-ds]');
      if (ds) {
        var d = data.datasets.filter(function (x) { return x.id === ds.getAttribute('data-ds'); })[0];
        if (e.target.closest('[data-open-ds]')) { UI.store.set('lab-load', { spec: d.spec }); UI.go('lab'); return; }
        if (e.target.closest('[data-del-ds]')) {
          UI.confirm({ title: 'Delete “' + d.name + '”?', text: 'Listings made from it keep their own copy of the columns.', ok: 'Delete', danger: true })
            .then(function (yes) { if (yes) UI.api('delete_dataset', d.id).then(load); });
        }
      }
    });
    return load();
  });
})();

/* ===== profile.html ===== */
(function () {
  var esc = UI.esc;
  UI.page('profile', { title: 'Your profile', auth: 'user' }, function (view, ctx) {
    var me = ctx.me;
    view.innerHTML = '<div class="ui-wrap ui-narrow"><div class="pf-head"><span class="ui-avatar">' + esc(UI.initials(me.name)) + '</span>' +
      '<div><h1>' + esc(me.name) + '</h1><div class="muted">' + esc(me.email) + (me.joined ? ' · member since ' + esc(UI.fmtDate(me.joined, { month: 'long', year: 'numeric' })) : '') + '</div></div></div>' +
      '<div class="pf-grid"><form class="ui-card ui-stack" data-name><h3>Your name</h3><label class="ui-field"><span>Shown to other people</span>' +
      '<input type="text" name="name" value="' + esc(me.name) + '" maxlength="60" required></label><button class="ui-btn primary" type="submit">Save</button></form>' +
      '<div class="ui-card ui-stack"><h3>Appearance</h3><p class="muted small">Follow your device, or pick one.</p><div data-theme-box></div>' +
      '<h3 style="margin-top:22px">Password</h3><p class="muted small">We\'ll email you a link to choose a new one.</p>' +
      '<button class="ui-btn" data-reset>' + UI.icon('mail') + 'Email me a reset link</button></div></div>' +
      '<div class="ui-card" style="margin-top:16px"><div class="pf-links">' +
      (me.is_admin ? '<a href="#admin" data-go="admin">' + UI.icon('shield') + 'Admin</a>' : '') +
      '<button data-feedback>' + UI.icon('chat') + 'Send feedback</button>' +
      '<button data-lk-open="overview">' + UI.icon('lock') + 'Privacy &amp; Terms, and your data</button>' +
      '<button data-signout-here>' + UI.icon('logout') + 'Sign out</button></div></div></div>';
    function themeBox() {
      var t = UI.theme();
      view.querySelector('[data-theme-box]').innerHTML = '<div class="ui-seg">' + [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(function (o) {
        return '<button type="button" data-theme-pick="' + o[0] + '" class="' + (t === o[0] ? 'on' : '') + '">' + o[1] + '</button>';
      }).join('') + '</div>';
    }
    themeBox();
    view.addEventListener('click', function (e) {
      var t = e.target.closest('[data-theme-pick]');
      if (t) { UI.setTheme(t.getAttribute('data-theme-pick')); themeBox(); UI.renderChrome(); return; }
      if (e.target.closest('[data-reset]')) {
        UI.busy(e.target.closest('[data-reset]'), UI.auth('reset', { email: me.email })).then(function (r) { UI.toast(r.message, 'ok'); });
      }
      if (e.target.closest('[data-signout-here]')) UI.auth('logout');
    });
    view.querySelector('[data-name]').addEventListener('submit', function (e) {
      e.preventDefault();
      var v = UI.formData(e.target);
      UI.busy(e.target.querySelector('[type=submit]'), UI.api('update_profile', v.name)).then(function (r) {
        UI.setMe(r.me); ctx.me = r.me; UI.toast('Saved', 'ok');
        view.querySelector('.pf-head h1').textContent = r.me.name;
      });
    });
  });
})();

/* ===== snippet.html ===== */
(function () {
  var esc = UI.esc;
  UI.page('snippet', { title: 'Listing' }, function (view, ctx) {
    var id = ctx.args[0], s = null, files = null, live = false, cur = 'train', editing = false;
    view.innerHTML = '<div class="ui-wrap"><div class="ui-skel" style="height:320px"></div></div>';
    if (!id) { UI.go(ctx.me ? 'notebook' : 'commons'); return Promise.resolve(); }

    function draw() {
      var m = RI.MODEL[s.model] || { name: s.model, slug: s.model, short: s.model };
      var spec = RI.cleanSpec(s.spec);
      document.title = s.title + ' · RoboIntern';
      var back = s.can_edit ? '<a href="#notebook">Notebook</a>' : '<a href="#commons">Commons</a>';
      var acts = [];
      if (s.can_edit) {
        acts.push('<button class="ui-btn sm" data-star aria-pressed="' + s.starred + '">' + (s.starred ? '★ Starred' : '☆ Star') + '</button>');
        acts.push('<button class="ui-btn sm" data-public>' + UI.icon(s.is_public ? 'lock' : 'share') + (s.is_public ? 'Make private' : 'Share in the Commons') + '</button>');
        acts.push('<button class="ui-btn sm" data-edit-meta>' + UI.icon('edit') + 'Edit details</button>');
      } else {
        acts.push('<button class="ui-btn sm primary" data-fork>' + UI.icon('fork') + 'Fork to my notebook</button>');
      }
      acts.push('<button class="ui-btn sm" data-open-lab>' + UI.icon('flask') + 'Open in the Lab</button>');
      if (s.can_delete) acts.push('<button class="ui-btn sm ghost danger" data-delete aria-label="Delete">' + UI.icon('trash') + '</button>');
      var xi = 0;
      view.innerHTML = '<div class="ui-wrap"><div class="at-crumbs" style="font:.8rem/1.4 var(--font-mono);color:var(--c-muted);margin-bottom:10px">' + back + ' › listing</div>' +
        '<div class="sn-head"><div><div class="ri-meta"><span class="ri-listing-no">Listing</span><a href="#atlas/model/' + esc(m.slug) + '">' + esc(m.name) + '</a><span>' + esc(RI.TASKS[s.task] || s.task) + '</span>' +
        (s.is_public ? '<span class="ui-badge good">public</span>' : '<span class="ui-badge">private</span>') + (s.demo ? '<span class="ui-badge">demo</span>' : '') + '</div>' +
        '<h1>' + esc(s.title) + '</h1><div class="ri-meta"><span>by ' + esc(s.author) + '</span><span>updated ' + esc(UI.ago(s.updated)) + '</span>' +
        (s.cites ? '<span>cited ' + s.cites + '×</span>' : '') + s.tags.map(function (t) { return '<span>#' + esc(t) + '</span>'; }).join('') +
        (s.forked_from ? '<span>forked from <a href="#snippet/' + esc(s.forked_from.id) + '">' + esc(s.forked_from.title) + '</a> by ' + esc(s.forked_from.author) + '</span>' : '') + '</div></div>' +
        '<div class="sn-acts">' + acts.join('') + '</div></div>' +
        (s.notes ? '<div class="ri-thm"><b>Notes.</b> <span class="sn-notes">' + esc(s.notes) + '</span></div>' : '') +
        '<div class="sn-grid"><div>' +
        (live ? '<p class="sn-live muted">' + UI.icon('refresh') + ' Written live from the data description by today’s RoboIntern.' + (s.can_edit ? ' Edit the code to keep your own version.' : '') + '</p>' : '') +
        (editing ? '<form data-code-form><div class="ri-code-bar" style="border:1px solid var(--c-line);border-bottom:0">' + RI.FILES.map(function (f) { return '<span class="ri-file' + (f[0] === cur ? ' on' : '') + '">' + f[1] + '</span>'; }).join('') + '</div>' +
          '<textarea class="sn-edit" name="code" spellcheck="false" aria-label="Edit ' + esc(cur) + '">' + esc(files[cur] || '') + '</textarea>' +
          '<div class="ui-row end" style="margin-top:10px"><button type="button" class="ui-btn ghost" data-cancel-edit>Cancel</button><button class="ui-btn primary" type="submit">' + UI.icon('save') + 'Save ' + esc(RI.FILES.filter(function (f) { return f[0] === cur; })[0][1]) + '</button></div></form>'
          : RI.codeBlock(files, cur, s.can_edit ? '<button type="button" class="ui-btn sm ghost" data-edit-code>' + UI.icon('edit') + '<span>Edit</span></button>' : '')) +
        (s.can_edit && !live && !editing ? '<p class="small muted" style="margin-top:10px"><button type="button" class="ui-btn sm ghost" data-regen>' + UI.icon('refresh') + 'Regenerate from the description</button> replaces your edits with a fresh listing.</p>' : '') +
        '</div><aside class="sn-side"><div class="ui-card"><h3 style="font-size:1.02rem">Data description</h3><div class="ri-tex">' + RI.tex(RI.notation(spec), true) + '</div>' +
        '<table class="sn-cols"><tbody>' + spec.columns.map(function (c) {
          var g = c.role === 'target' ? 'y' : c.role === 'time' ? 't' : c.role === 'group' ? 'g' : c.role === 'ignore' ? '∅' : 'x';
          return '<tr><td><span class="ri-role ' + c.role + '">' + g + (c.role === 'feature' ? '<sub>' + (++xi) + '</sub>' : '') + '</span></td><td class="nm">' + (c.key ? '<span class="ri-hl">' + esc(c.name) + '</span> ★' : esc(c.name)) + '</td>' +
            '<td class="ty">' + esc(c.type) + (c.known && s.task === 'forecast' ? ' · known' : '') + '</td></tr>';
        }).join('') + '</tbody></table>' +
        (spec.task === 'forecast' ? '<p class="small muted" style="margin:10px 0 0">' + esc(RI.FREQ[spec.freq].name) + ', horizon ' + spec.horizon + ' ' + esc(RI.FREQ[spec.freq].unit) + '</p>' : '') + '</div>' +
        '<div class="ui-card"><h3 style="font-size:1.02rem">How to run it</h3><ol class="small" style="padding-left:1.2em;margin:0">' +
        '<li>Save the three files in one folder, next to <code>' + esc(spec.file) + '</code>.</li><li><code>pip install -r requirements.txt</code></li><li><code>python train.py</code></li>' +
        '<li><code>python predict.py' + (spec.task === 'forecast' || m.tmpl === 'anomts' ? '' : ' new.csv') + '</code></li></ol>' +
        '<p class="small muted" style="margin:10px 0 0">Prefer notebooks? The <b>.ipynb</b> button above packs all three files into one.</p></div></aside></div></div>';
    }
    function setFrom(snip) {
      s = snip;
      live = !s.files || !s.files.train;
      files = live ? RI.generate(s.spec, s.model, s.title) || { train: '# This model is no longer in RoboIntern.', predict: '', requirements: '' } : s.files;
    }
    function persist(data, msg) {
      return UI.api('save_snippet', s.id, data).then(function (r) { setFrom(r.snippet); editing = false; draw(); if (msg) UI.toast(msg, 'ok'); });
    }
    view.addEventListener('click', function (e) {
      var t;
      if ((t = e.target.closest('[data-file]')) && !editing) { cur = t.getAttribute('data-file'); draw(); return; }
      if (e.target.closest('[data-star]')) { persist({ starred: !s.starred }); return; }
      if (e.target.closest('[data-public]')) {
        var going = !s.is_public;
        UI.confirm({ title: going ? 'Share in the Commons?' : 'Make it private?', text: going ? 'Everyone can see the title, notes, tags, column names and code, with your name, and fork a copy.' : 'It disappears from the Commons. Copies others already forked stay theirs.', ok: going ? 'Share' : 'Make private' })
          .then(function (yes) { if (yes) persist({ is_public: going }, going ? 'Shared in the Commons' : 'Now private'); });
        return;
      }
      if (e.target.closest('[data-edit-meta]')) { editMeta(); return; }
      if (e.target.closest('[data-edit-code]')) { editing = true; draw(); view.querySelector('.sn-edit').focus(); return; }
      if (e.target.closest('[data-cancel-edit]')) { editing = false; draw(); return; }
      if (e.target.closest('[data-regen]')) {
        UI.confirm({ title: 'Regenerate the code?', text: 'Your edits to all three files are replaced by a fresh listing from the data description.', ok: 'Regenerate', danger: true })
          .then(function (yes) { if (yes) persist({ files: RI.generate(s.spec, s.model, s.title) }, 'Regenerated'); });
        return;
      }
      if (e.target.closest('[data-open-lab]')) { UI.store.set('lab-load', { spec: s.spec, model: s.model }); UI.go('lab'); return; }
      if ((t = e.target.closest('[data-fork]'))) {
        if (!ctx.me) { UI.after = location.hash; UI.toast('Sign in to fork listings into your notebook'); UI.go('auth', 'signup'); return; }
        UI.busy(t, UI.api('fork_snippet', s.id)).then(function (r) { UI.toast('Forked into your notebook', 'ok'); UI.go('snippet', r.snippet.id); });
        return;
      }
      if (e.target.closest('[data-delete]')) {
        UI.confirm({ title: 'Delete this listing?', text: 'This can’t be undone.', ok: 'Delete', danger: true }).then(function (yes) {
          if (yes) UI.api('delete_snippet', s.id).then(function () { UI.toast('Deleted'); UI.go(s.can_edit ? 'notebook' : 'commons'); });
        });
      }
    });
    view.addEventListener('submit', function (e) {
      if (!e.target.matches('[data-code-form]')) return;
      e.preventDefault();
      var next = { train: files.train, predict: files.predict, requirements: files.requirements };
      next[cur] = e.target.querySelector('[name=code]').value;
      UI.busy(e.target.querySelector('[type=submit]'), persist({ files: next }, 'Saved'));
    });
    view.addEventListener('keydown', function (e) {
      if (e.key === 'Tab' && e.target.matches('.sn-edit')) {
        e.preventDefault();
        var ta = e.target, a = ta.selectionStart;
        ta.value = ta.value.slice(0, a) + '    ' + ta.value.slice(ta.selectionEnd); ta.selectionStart = ta.selectionEnd = a + 4;
      }
    });
    RI.wireCode(view, function () { return files; }, function () {}, function () { return { title: s.title, model: s.model, spec: s.spec, notes: s.notes }; });
    function editMeta() {
      var dlg = UI.modal('<h2>Edit details</h2><form class="ui-stack" data-meta><label class="ui-field"><span>Title</span><input type="text" name="title" maxlength="120" required value="' + esc(s.title) + '"></label>' +
        '<label class="ui-field"><span>Notes</span><textarea name="notes" maxlength="4000">' + esc(s.notes) + '</textarea></label>' +
        '<label class="ui-field"><span>Tags <em>(comma-separated)</em></span><input type="text" name="tags" maxlength="200" value="' + esc(s.tags.join(', ')) + '"></label>' +
        '<div class="ui-row end"><button type="button" class="ui-btn ghost" data-close>Cancel</button><button class="ui-btn primary" type="submit">Save</button></div></form>');
      var form = dlg.el.querySelector('[data-meta]');
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var v = UI.formData(form);
        UI.busy(form.querySelector('[type=submit]'), persist({ title: v.title, notes: v.notes, tags: v.tags.split(',').map(function (x) { return x.trim(); }).filter(Boolean) }, 'Saved')).then(function () { dlg.close(); });
      });
    }
    return UI.api('get_snippet', id).then(function (r) { setFrom(r.snippet); draw(); RI.whenTex(draw); }, function (err) {
      view.innerHTML = '<div class="ui-wrap"><div class="ui-empty">' + UI.icon('lock') + '<h3>' + esc(err.message) + '</h3><p class="muted">It may have been deleted, or made private by its author.</p>' +
        '<a class="ui-btn" href="#commons" data-go="commons">Browse the Commons</a></div></div>';
    });
  });
})();
