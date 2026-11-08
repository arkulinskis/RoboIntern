---
name: robointern
description: Context, workflow and recipes for RoboIntern (folder RoboIntern-forms), the user's Anvil app built as native Anvil Forms (Python + HTML templates, a layout, custom components, RepeatingPanels) around a JavaScript engine. A field guide to ML models for prediction: describe data by its columns, get ranked models, maths and runnable Python. Load this before any feature request, bug fix, restyle, content change or deploy for this app.
---

# RoboIntern: working on the app

**What it is:** a lookup dictionary of machine-learning strategies for predicting from historical data, plus a code writer. People describe a dataset as a list of columns (paste a header row, mark target / time / series / key drivers / known-ahead) in **the Lab**; RoboIntern ranks the models with a visible formula and writes train.py, predict.py and requirements.txt they run themselves (nothing runs on the site). **The Atlas** explains 43 models (11 families), 18 feature recipes, 9 validation schemes and 17 metrics with typeset maths.
Six tasks: forecast, regression, binary, multiclass, **anomaly** (y optional) and **cluster** (y optional). A spec flag **tune** adds an Optuna search; every listing exports as a **Jupyter notebook** (RI.notebook). **The Casebook** links 105 business situations in 10 industries (each one of 11 "shapes") to models, outside signals, decision rules and live code. Members keep listings and data descriptions in a **Notebook** and share them in **the Commons** (forks = citations).

**Where it lives:**
- Folder `C:\Users\arkvi\Documents\CLAUDE\RoboIntern-forms\` = the git clone of **github.com/arkulinskis/RoboIntern**. "git" layout: the folder *is* the Anvil app. Converted to Forms on branch `forms` (2026-11-08); after the user merges, Anvil pulls `master` and pushing is the deploy. Live: https://robointern.com.
- The old JavaScript source folder `C:\Users\arkvi\Documents\CLAUDE\RoboIntern` (web/ + tools/deploy.py) is the pre-Forms version: retire it after the merge (CONVERT.md step 5), never deploy from it again.
- Made like `APP_MAKER\template-forms`. Anvil's agent skills describe the same model (APP_MAKER/ANVIL_NOTES.md, "Native Anvil Forms").
- **README.md** lists every feature. Keep it up to date. **APP_MAP.md** is the code map (regenerate after changes).

**What the user wants:** "very math nerd" design: **LaTeX paper**: warm paper #faf8f2 with a faint 24px graph-paper grid, ink #1a1a22, hyperref blue #1f3a93 (brand), red-pen #b3261e (accent, the target y); dark #12141c. STIX Two Text headings, Source Serif 4 body, JetBrains Mono for labels and code; 2-3px radii, no shadows, hairline and double rules, theorem boxes (`.ri-thm`: a hairline box with a faint tint since the design-kit facelift), § section numbers, KaTeX. Icon: a robot face on blue with a parabola smile. "Complete": start with popular models and keep expanding. Claude assumes details and builds; Claude deploys. Mobile-first: every page fits 390 px. Light and dark.

## Workflow for any change

1. `git pull --ff-only` (Anvil commits "Edited ..." when the user changes something in the IDE).
2. Edit a page's template and Python side by side (`client_code/Pages/X/form_template.html` + `__init__.py`), or the engine/screens (`theme/assets/ri-*.js`).
3. `python tools/check.py` (no -I) -> **ALL CHECKS PASSED**: `anvil validate`, JS syntax, asset hashes (`tools/assets.py`), server tests, and the Casebook check (`tools/testing/codegen/cases.js`).
4. `python -I tools/ui_test.py` (Docker Desktop running) -> the smoke test (tools/ui/smoke.js: every address signed out, as a member, as admin, desktop + phone; fails on errors, empty pages, sideways scroll). Container `robointern-dev`; server edits need `--restart`; `--stop` at the end. `--only a11y.js` / `design.js` for the deeper checks.
5. Commit as arkulinskis with the Co-Authored-By line; push. New tables/columns: tell the user to accept the **Schema Mismatch** alert.

## Architecture

```
anvil.yaml                startup module `startup`; db_schema; head_html: fonts, KaTeX (cdnjs, defer), Prepsto, legal-kit.js,
                          icons.css, app.css, app-kit.js, ri-kit.js, ri-engine.js, ri-screens.js (?v= hashes: tools/assets.py)
client_code/
  startup.py              get_me, Privacy & Terms, ri.setup(), router.start()
  router.py               PAGES / NAV (Lab, Cases, Atlas, Notebook*, Commons) / _form; HOME = notebook; same #addresses as before
  state.py                me() (set_me also sets UI.me for the screens), call(), toast(), store, set_attr, dates
  auth.py, legal.py       sign in/up/Google/out; Privacy & Terms kit (don't edit legal.py)
  ri.py                   the engine seen from Python: meta() (counts, tasks, models, industries, samples), model_name,
                          task_name, eq, js(name, ...) = RI.py.<name> as JSON; RI_BRIDGE (server calls for the screens);
                          RI.host (toast, confirm, remember_after, save_listing, save_dataset, go)
  Layouts/Shell           header (menu for everyone, Notebook for members), account menu, footer (4 links), phone tab bar;
                          refresh(page) also sets page-<name> on the frame
  Pages/                  Landing, Auth, Profile, Admin (+ Commons moderation tab), Notebook, Commons, Snippet (Forms);
                          Lab, Atlas, Cases = a Components/Screen each (JS screens)
  Components/             Screen (mounts a ri-screens.js screen), Tex (RI.tex formula), CodeBlock (RI.codeBlock + wireCode)
  Items/                  NavLink, FeedbackRow, UserRow, IndustryTile, CaseTeaser, MathCard, Tag (chips), NoteItem,
                          DatasetRow, SampleCard, CommonsCard, SpecCol, CommonsAdminRow
  Dialogs/                SaveListing, SaveDataset (the Lab's, via RI.host), EditDetails (a listing's title/notes/tags)
server_code/              common.py (C.*), Accounts, Admin, Commons, DemoData, Feedback, Notebook, Specs, SchemaCheck,
                          legal_server, seo_routes (unchanged by the conversion)
theme/assets/
  ri-engine.js            RI.MODELS/FEATURES/VALIDATION/METRICS/FAMILIES (Atlas data), RI.INDUSTRIES/SHAPES/CASES (+ caseSpec,
                          casesFor), RI.parse, guessRoles, inferTask, cleanSpec, derive, problem, recommend, generate (code
                          templates genTab, genTabForecast, genStat, genTorch, genFM, genAnom, genAnomTS, genClus; SPACE = Optuna),
                          highlight, codeBlock/wireCode, notebook, notation, tex/mtext/whenTex, SAMPLES
  ri-screens.js           UI.page('lab' | 'atlas' | 'cases', ...): the three interactive screens, unchanged JS
  ri-kit.js               the UI.* shim the engine/screens use (api via RI_BRIDGE, toast/confirm via RI.host, go, ago, busy,
                          [data-go] clicks, UI.after -> router) + RI.py.* JSON helpers for Python
  app.css                 tokens + design kit + template core + LaTeX look + engine/page CSS + role layer + Forms parts (end)
  app-kit.js / icons.css  UI.ICONS (app icons included; tools/build_icons.py), theme, store (key "robointern")
tools/                    check.py, assets.py, build_icons.py, make_icons.py, ui_test.py + ui/smoke.js, live/drive.mjs,
                          testing/test_server.py (+ mock), testing/codegen/ (gen.js, cases.js, run.py: read ri-engine.js)
```

## How things are done here

- **Page** = `client_code/Pages/X/` with `<anvil-form layout="RoboIntern.Layouts.Shell">`, `class X(XTemplate)` taking `args=()`. Register in router.py (PAGES, _form, NAV) and add its address to tools/ui/smoke.js.
- **Screen pages** (Lab, Atlas, Cases) set `waits = True`; the screen sets UI_READY when mounted. Every hash change re-opens the page and re-mounts the screen (as the JS version did). Their dialogs are Python Forms reached through RI.host; confirmations go through `UI.confirm` -> Python `confirm()`.
- **Hand-offs between pages** go through browser storage (`state.store_set` / `UI.store`, prefix "robointern."): `lab` (the Lab draft), `lab-load` = `{spec, model?, text?}` (open something in the Lab: notebook, listing, case, sample), `lab-pick` = model slug (from the Atlas).
- **Engine data in Python** only as JSON text (`ri.js(...)`, `ri.meta()`), never JS objects.
- **Lists** = RepeatingPanel + Items form; grid CSS on `.anvil-role-<role> > div`; chips = Items/Tag `{text, kind}` (code, sig, meta, good, badge).
- **Formulas** = Components/Tex (`.tex`, `.display`); prose with `$...$` = `RI.mtext` HTML into a dom-node.
- **Actions** = Anvil Buttons with roles (`btn`, `btn-primary`, `btn-sm`, `ic-<icon>`); seg toggles role `["seg", "on"]`.
- **Server calls**: `state.call` for flows; Snippet calls `anvil.server.call("get_snippet")` itself (friendly "private / deleted" page).
- Accessibility and design kit rules as in template-forms' guide (APP_MAKER/design/README.md; `design_check.py` is CLEAN, 4/4).

## Recipes

- **New page / server function / table**: as template-forms (server tests in tools/testing/test_server.py; public callables in `PUBLIC`; schema in anvil.yaml db_schema).
- **Add a model:** an entry in `RI.MODELS` (ri-engine.js, Atlas data section: slug, short, family, tasks, lib, pip, power/interp/speed, minRows/maxRows, cat/miss/ivals/global/scale, tmpl, eq/obj TeX, prose, params, related). Its code: `tmpl: 'tab'` -> `EST` (reg/clf constructors, imp, flags); `'stat'` -> `FIT[slug]`; `'torch'` -> `NETS[slug]`. pip names in `req()`. Then the codegen test.
- **Tuning:** search space in `SPACE`; `RI.tunable(spec, m)` decides.
- **Notebook export:** `RI.notebook(files, meta)` splits train.py at double blank lines; keep two blank lines between top-level defs.
- **Codegen test (after any generator change):** `node tools/testing/codegen/gen.js OUT [slug ...]` then `run.py OUT` with a Python that has the ML libraries (scratch venv: `python -m venv --system-site-packages V`, `V/Scripts/python -m pip install statsmodels "lightgbm!=4.7.0" xgboost catboost prophet optuna "chronos-forecasting>=2.0"`; TimesFM in its own venv). `--nb` runs the notebooks too. Every folder must PASS.
- **Add Atlas content:** FEATURES / VALIDATION / METRICS entries; TeX in `String.raw`; `$...$` in prose via `RI.mtext`.
- **Add a Lab sample:** `RI.SAMPLES` (text, tweak(col), task, freq, horizon, rows). The notebook's quick starts list them automatically.
- **Add a Casebook case:** an entry in `RI.CASES` (field list in the Casebook data header comment). `node tools/testing/codegen/cases.js` must say `cases OK` (check.py runs it); then `cases.js OUT all` + run.py. New industry: RI.INDUSTRIES (+ icon in the engine's IC and in app-kit.js UI.ICONS, then tools/build_icons.py).
- **Demo listings:** `DEMO_SNIPPETS` in DemoData.py: spec + model only (files None), always the current generator.
- **Restyle:** tokens at the top of app.css (light + dark), fonts in head_html, spinner in theme.css, `LEGAL_THEME` in startup.py.
- **Icon:** theme/assets/icon.svg, `python -I tools/make_icons.py`, `python tools/assets.py`.

## Gotchas

- Generated scripts must print ASCII only (Windows consoles crash on ★ ² ±). Generated feature names are prefixed (`cal_month`, `lag_7`) so they never overwrite a user column.
- LightGBM 4.7.0 crashes on Windows with pandas input (`lightgbm>=4.0,!=4.7.0`). statsmodels ETS `get_prediction` needs a pandas Series. Torch predict.py uses `reindex(columns=...)` for missing past-only columns.
- Phone layout: grids use `minmax(0, 1fr)`; KaTeX's hidden MathML is pinned inside `.katex` (app.css), or formulas push the page sideways.
- KaTeX loads with `defer`; the engine's `RI.whenTex(fn)` redraws (Components/Tex does it by itself).
- Form templates collapse leading spaces: indented code in a template needs `&#160;` (the landing hero's code).
- TimesFM 3.0 weights are non-commercial (the listing uses 2.5). uni2ts (Moirai) is not offered.
- Univariate models ignore drivers; a case page marks signals the picked model can't read.
- The parser guesses money-like names (`amount`, `price`) as the target: anomaly/cluster samples set roles in `tweak`.
- Never write Anvil's theme-colour token pattern (percent, `color:`, name, percent) in theme.css.
- No `gh` CLI; git pushes over HTTPS through Git Credential Manager.

## Privacy & Terms (legal kit)

From `C:/Users/arkvi/Documents/CLAUDE/APP_MAKER/legal-kit` (`apps/robointern.json`): `python -I build.py robointern && python -I install.py robointern` there (writes theme/assets/legal-kit.js, client_code/legal.py, server_code/legal_server.py and the head_html tag), then `python tools/assets.py`. The `cdnjs_katex` provider is listed for this app. Sign-up keeps the tick box (Pages/Auth). Feedback = Prepsto only ("Submit feedback", code dqt9qx8). Consent is stored in `users.legal_version`, `legal_accepted_at`, `legal_source`. Continue with Google needs `use_google` + the Google service (anvil.yaml).
