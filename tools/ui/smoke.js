/* Smoke test (tools/ui_test.py runs it at 1280 px and at 390 px): every page address opens without errors, is not
   empty and doesn't scroll sideways. Signed out: landing, the Lab, the Atlas (index, a tab, a model), the Casebook
   (matrix, an industry, a case), the Commons, a shared listing, sign in / up. Then as a new member: the empty
   notebook, a quick start into the Lab, the Lab's two save dialogs, a listing (fork + edit details dialog), profile.
   Then as admin: every Admin tab. Python/JS errors are caught by ui_test.py from the browser log. Resolves to {ok, log}. */
(async function () {
  const log = [], bad = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function until(fn, what, ms) {
    const end = Date.now() + (ms || 20000);
    while (Date.now() < end) { try { const v = fn(); if (v) return v; } catch (e) {} await sleep(150); }
    throw new Error('timed out waiting for: ' + what);
  }
  const $ = (s) => document.querySelector(s), $$ = (s) => Array.from(document.querySelectorAll(s));
  const errs = [];
  window.addEventListener('error', (e) => errs.push(String(e.message || e)));
  const visible = (el) => !!el && el.getClientRects().length > 0;
  function type(input, value) {
    input.focus(); input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function button(re, root) { return $$((root || '') + ' button').find((b) => re.test(b.textContent.trim()) && visible(b)); }
  function check(name, expect) {
    const main = $('.ui-main');
    const text = main ? main.innerText.trim() : '';
    const w = document.documentElement.scrollWidth, vw = screen.width <= 500 ? screen.width : window.innerWidth;
    const problems = [];
    if (text.length < 40) problems.push('empty page');
    if (expect && !new RegExp(expect.source, 'i').test(text)) problems.push('missing ' + expect);
    if (w > vw + 1) {
      const wide = $$('body *').filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.right > vw + 1; })
        .slice(0, 3).map((e) => e.tagName.toLowerCase() + '.' + String(e.className).split(' ').slice(0, 2).join('.'));
      problems.push('scrolls sideways (' + w + ' > ' + vw + ') ' + wide.join(' '));
    }
    if (errs.length) problems.push('errors: ' + errs.splice(0).join(' / '));
    if (problems.length) bad.push(name + ': ' + problems.join('; '));
    log.push((problems.length ? 'BAD  ' : 'ok   ') + name);
  }
  async function open(hash, expect) {
    if (location.hash !== hash) window.UI_READY = false;
    location.hash = hash;
    await until(() => window.UI_READY && location.hash === hash, hash, 30000);
    await sleep(800);
    check(hash, expect);
  }
  async function dialog(name, opener, expect) {
    if (!opener) { bad.push('dialog ' + name + ': no button to open it'); return; }
    opener.click();
    const dlg = await until(() => $$('.modal, .anvil-modal').find((m) => visible(m) && m.innerText.trim().length > 10), 'dialog ' + name, 15000);
    await sleep(400);
    const text = dlg.innerText;
    const problems = [];
    if (expect && !expect.test(text)) problems.push('missing ' + expect);
    if (errs.length) problems.push('errors: ' + errs.splice(0).join(' / '));
    if (problems.length) bad.push('dialog ' + name + ': ' + problems.join('; '));
    log.push((problems.length ? 'BAD  ' : 'ok   ') + 'dialog ' + name);
    const close = $$('.modal button, .anvil-modal button').find((b) => /^(Cancel|Close)$/.test(b.textContent.trim()) && visible(b));
    if (close) close.click();
    await until(() => !$$('.modal, .anvil-modal').some(visible), 'dialog closed', 10000);
    await sleep(300);
  }
  async function signUp(name, email, password) {
    location.hash = '#auth/signup';
    await until(() => window.UI_READY && $$('.au-card input').length >= 3, 'sign-up form');
    await sleep(400);
    const inputs = $$('.au-card input[type=text], .au-card input[type=email], .au-card input[type=password]');
    type(inputs[0], name); type(inputs[1], email); type(inputs[2], password);
    const tick = $('.au-card input[type=checkbox]'); if (tick && !tick.checked) tick.click();
    button(/Create account/, '.au-card .anvil-role-btn-block').click();
    const end = Date.now() + 30000;
    while (Date.now() < end) {
      if (location.hash === '#notebook' && window.UI_READY) return true;
      const msg = $('.au-card .anvil-role-msg-error');
      if (msg && visible(msg) && msg.textContent.trim()) { log.push('sign-up said: ' + msg.textContent.trim()); return false; }
      await sleep(200);
    }
    log.push('sign-up: still on ' + location.hash);
    return false;
  }
  async function signIn(email, password) {
    location.hash = '#auth';
    await until(() => window.UI_READY && $$('.au-card input[type=password]').length, 'sign-in form');
    await sleep(400);
    type($('.au-card input[type=email]'), email); type($('.au-card input[type=password]'), password);
    button(/Sign in/, '.au-card .anvil-role-btn-block').click();
    await until(() => location.hash === '#notebook' && window.UI_READY, 'signed in as ' + email, 30000);
  }
  async function signOut() {
    $('.anvil-role-avatar button').click();
    await sleep(300);
    button(/Sign out/, '.ui-menu').click();
    await until(() => {
      const a = $('.anvil-role-avatar button');
      return location.hash === '#landing' && window.UI_READY && (!a || !visible(a));
    }, 'signed out');
    await sleep(500);
  }
  try {
    // ---- signed out
    await open('#landing', /Get the model, and the Python/);
    const teaser = $$('.lp-ind').length === 10 && $$('.lp-case').length === 2 && $$('.lp-mathcard').length === 3;
    if (!teaser) bad.push('landing: Casebook teaser / typeset models missing');
    await open('#lab', /Lab/);
    $$('[data-sample]')[0].click();
    await sleep(900);
    check('#lab (a sample)', /train\.py/);
    await open('#atlas', /Atlas/);
    await open('#atlas/features', /lag/);
    await open('#atlas/model/lgbm', /LightGBM/);
    await open('#cases', /Casebook/);
    await open('#cases/retail', /Retail/);
    const caseHref = ($$('a[href^="#cases/retail/"]')[0] || {}).getAttribute && $$('a[href^="#cases/retail/"]')[0].getAttribute('href');
    if (caseHref) await open(caseHref, /Open in the Lab/); else bad.push('no case link on #cases/retail');
    await open('#commons', /listings people shared/);
    await until(() => $$('.cm-card').length, 'Commons listings (demo data)', 20000);
    const snipHref = $('.cm-card').getAttribute('href');
    await open(snipHref, /How to run it/);
    await open('#snippet/no-such-listing', /deleted, or made private/);
    await open('#auth', /Sign in/);
    await open('#auth/signup', /Create account/);

    // ---- a new member
    const pw = 'Ri-' + Math.random().toString(36).slice(2) + '-Kq7';
    if (!(await signUp('Smoke Member', 'smoke' + Date.now() + '@example.com', pw))) throw new Error('sign-up failed');
    await sleep(800);
    check('#notebook (empty)', /notebook is empty/);
    const sample = button(/\S/, '.anvil-role-nb-start');
    if (!sample) throw new Error('no quick start on the empty notebook');
    sample.click();
    await until(() => location.hash === '#lab' && window.UI_READY && $('[data-save-snippet]'), 'the Lab with a sample', 30000);
    await sleep(800);
    check('#lab (quick start)', /train\.py/);
    await dialog('save listing', $('[data-save-snippet]'), /Save to your notebook/);
    await dialog('save data description', $('[data-save-ds]'), /Save the data description/);
    await open(snipHref, /How to run it/);
    if (!button(/Fork to my notebook/)) bad.push('listing: no Fork button for a member');
    button(/Fork to my notebook/).click();
    await until(() => button(/Edit details/) && window.UI_READY, 'the forked listing', 30000);
    await sleep(600);
    check('#snippet (my fork)', /Notebook/);
    await dialog('edit details', button(/Edit details/), /Edit details/);
    await open('#notebook', /Listing 1/);
    await open('#commons', /listings people shared/);
    await open('#profile', /Appearance/);
    await open('#landing', /Start in the Lab/);
    await signOut();

    // ---- admin (ADMIN_EMAILS in Accounts.py): sign up the first time, sign in after that
    const adminPw = 'Ri-smoke-adm-93Kx-7q';
    if (!(await signUp('Admin Tester', 'arkulinskis@gmail.com', adminPw))) await signIn('arkulinskis@gmail.com', adminPw);
    for (const t of ['overview', 'feedback', 'users', 'commons', 'demo']) await open('#admin/' + t, /Admin/);
    await signOut();
    log.push(bad.length ? 'PROBLEMS: ' + bad.join(' | ') : 'PASSED');
    return { ok: !bad.length, log: log };
  } catch (e) {
    log.push(String(e && e.message || e));
    if (bad.length) log.push('PROBLEMS: ' + bad.join(' | '));
    return { ok: false, log: log };
  }
})();
