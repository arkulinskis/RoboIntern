# RoboIntern

A field guide to machine-learning models for predicting from historical data, with the Python included. You describe
your data the way it already exists, as a list of columns: paste a header row, mark the target, the time column, series
ids and your key drivers. RoboIntern ranks the models that fit with a visible scoring formula, explains the maths of each,
and writes `train.py`, `predict.py` and `requirements.txt` that you run on your own machine. Nothing runs on the site: it's a
lookup dictionary with a code writer. Built on [Anvil](https://anvil.works).

- **App repo:** github.com/arkulinskis/RoboIntern (branch `master`). Anvil pulls `master`.
- **Live:** not published yet.

## What it does

**For everyone (no account needed):**
- **The Lab** (`#lab`): paste a header row or a few rows (CSV, TSV, semicolons, a spreadsheet copy). Types and roles are
  guessed (date → time *t*, sales → target *y*, ids ignored, `store_id` → series *g* when forecasting). Each column gets
  a role (x feature, y target, t time, g series, ∅ ignore), a type, a ★ "key driver" highlight and, when forecasting, a
  "known ahead" tick. Task (forecast / regression / binary / multiclass / **anomaly detection** / **clustering**), frequency
  and horizon, data size, intervals, missing values, **cross-validated tuning** (adds an Optuna search to the code), and a
  draggable **priority simplex** (accuracy / interpretability / speed). The dataset is shown in set
  notation. **§4 Ranking**: every applicable model scored with S(m) = 20·wᵀ(p, q, r) + Σδ, with the adjustments listed.
  **§5 Code**: train.py / predict.py / requirements.txt, highlighted, copy and download, or all three as one **Jupyter
  notebook (.ipynb)**. Nine sample datasets. The draft is kept in the browser.
- **The Atlas** (`#atlas`): 43 models in 11 families, with Figure 1 (the model plane: interpretability × accuracy), and
  for each model its definition, objective (KaTeX), intuition, when to use it, assumptions, complexity, hyperparameters,
  strengths and weaknesses, profile, related models and a live example listing. Plus 18 feature-development recipes,
  9 validation schemes (with fold diagrams, including cross-validated tuning), 17 metrics, a sortable comparison table, and search.
- **The Commons** (`#commons`): listings members shared. Search, filter by task and model, sort by newest or most cited.
- Landing page, sign-up, feedback form, Privacy & Terms.

**For members:**
- **Notebook** (`#notebook`, the home page): their listings ("Listing n"), search, ★ star, public filter; their saved
  data descriptions (open in the Lab, delete); a "lemma of the day"; quick starts when empty.
- **Listing page** (`#snippet/<id>`): code tabs, .ipynb export, edit the code in place, edit title/notes/tags, share in or remove from
  the Commons, regenerate from the description, open in the Lab, delete. Others can **fork** a public listing (the
  original's citation count goes up).
- Save a listing or a data description from the Lab.

**For admins** (`#admin`; arkulinskis@gmail.com becomes an admin on first sign-in):
- **Overview** (people, listings, shared listings, data descriptions), **Feedback inbox**, **Users**.
- **Commons** moderation: unpublish or delete shared listings.
- **Demo data:** 4 fictional people and 12 shared listings (generated live from their descriptions); remove or reload.

## The generated code

Ten templates in `web/pages/_engine.html`, all run end to end on synthetic data (`tools/testing/codegen`):
- **tab**: scikit-learn pipeline (impute, scale or ordinal/one-hot, TF-IDF for text) + any sklearn/XGBoost/LightGBM/
  CatBoost estimator; time-ordered or stratified holdout; baselines; permutation importance; split-conformal or native
  intervals; refit on all data; `predict.py new.csv`.
- **tab-forecast**: one global model over all series with lags, rolling windows, calendar parts, known-ahead drivers
  used as-is and past-only drivers lagged by ≥ horizon; recursive forecasting; MASE vs seasonal naïve.
- **stat** (seasonal naïve, SARIMAX, ETS, Theta), **prophet**, **var**: per series, refit at forecast time.
- **torch** (LSTM, GRU, TCN, Transformer, N-BEATS, TFT): windowed direct multi-horizon network that also sees the known
  future. TFT outputs P10/P50/P90 quantiles (pinball loss); the others get conformal intervals.
- **fm** (Chronos-2, TimesFM 2.5): zero-shot foundation models; train.py only scores the holdout.
- **anom** (isolation forest, LOF, one-class SVM, robust covariance): scores every row, flags the top CONTAMINATION share,
  explains the top rows by robust z-scores, measures against a true/false label if there is one.
- **anomts** (STL residuals): per series, value vs. expected with a robust z-score.
- **clus** (k-means, Gaussian mixture, HDBSCAN, Ward): k by silhouette (BIC for the mixture), profiles in your own columns.

**Cross-validated tuning** (spec `tune`): an Optuna search on the training rows only. Tabular: k-fold / stratified /
time-series CV. Global forecasters and classical models: a rolling-origin backtest. Networks: validation loss.
Anomaly detectors: average precision against the label (only when there is one). Clustering: silhouette.
Zero-shot models and the STL detector have nothing to tune and say so.

## Setting it up in Anvil (once)

1. In the Anvil editor: **Create app → Clone from GitHub**, and paste `https://github.com/arkulinskis/RoboIntern`.
2. **Users** service: email + password, sign-up allowed (already set in `anvil.yaml`; check it).
3. Open the app in the editor. If it shows a **Schema Mismatch** alert, choose **"The schema of the source code is correct"** so Anvil creates the tables.
4. **Run** it and sign up with **arkulinskis@gmail.com** straight away (that account becomes the admin).
5. **Publish** (Publish → public URL, or your own domain).

## Working on it

See `.claude/skills/robointern/SKILL.md`. In short:

```
python -I tools/check.py --ui                    # syntax, server tests, headless UI tests → ALL CHECKS PASSED
python -I tools/preview/devserver.py 8765        # the app on in-memory data: http://localhost:8765/  (?as=ana#notebook, ?as=admin#admin)
node tools/testing/codegen/gen.js OUT            # every model × task listing; then run them with a Python that has the ML libraries:
python tools/testing/codegen/run.py OUT
python tools/deploy.py                           # dry run (needs PyYAML, so no -I)
python tools/deploy.py --push "Message"          # deploy: commit + push to GitHub, Anvil pulls it
```

## Project layout

```
web/pages/_atlas_data.html   the Atlas content: RI.MODELS, FEATURES, VALIDATION, METRICS, FAMILIES
web/pages/_engine.html       parser, recommender, code generator, highlighter, KaTeX helpers (window.RI)
web/pages/*.html             lab, atlas, notebook, snippet, commons, landing, auth, profile, admin
server_code/                 Specs.py (spec cleaning), Notebook.py, Commons.py, DemoData.py + the template modules
tools/testing/codegen/       gen.js + run.py: generate and execute every listing
```
