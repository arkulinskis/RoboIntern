"""Demo content, so the Commons never looks empty. Loaded automatically the first time anyone opens the app
(ensure_loaded), removed or reloaded from Admin -> Demo data. Removing it is remembered: it doesn't come back.

Demo people are fictional (is_demo=True, @example.com, no password, can't sign in). Their listings are public
and store only a spec + a model (files=None): the browser regenerates the Python from them, so the demo code
always matches the current generator. Every demo row is flagged is_demo=True, so remove() deletes exactly
what load() added.
"""
import datetime as dt

from anvil.tables import app_tables

from . import common as C

DEMO_USERS = [
    ("Noor Haddad", "noor.demo@example.com"),
    ("Felix Brandt", "felix.demo@example.com"),
    ("Priya Raman", "priya.demo@example.com"),
    ("Tomás Ibarra", "tomas.demo@example.com"),
]


def _c(name, type_, role="feature", key=False, known=False):
    return {"name": name, "type": type_, "role": role, "key": key, "known": known}


def _spec(cols, task, freq="D", horizon=14, rows="m", w=(0.5, 0.25, 0.25), intervals=False, missing=False, file="data.csv", tune=False):
    return {"columns": cols, "task": task, "freq": freq, "horizon": horizon, "rows": rows,
            "weights": {"acc": w[0], "interp": w[1], "speed": w[2]}, "intervals": intervals, "missing": missing,
            "tune": tune, "file": file}


BAKERY = _spec([_c("date", "datetime", "time"), _c("shop_id", "categorical", "group"),
                _c("temp_c", "numeric", known=True), _c("is_holiday", "boolean", known=True),
                _c("promo", "boolean", key=True, known=True), _c("loaves_sold", "numeric", "target")],
               "forecast", "D", 14, "m", (0.6, 0.15, 0.25), file="bakery_daily.csv")
CHURN = _spec([_c("customer_id", "id", "ignore"), _c("signup_date", "datetime"), _c("plan", "categorical", key=True),
               _c("monthly_spend", "numeric"), _c("support_tickets_90d", "numeric", key=True), _c("last_login_days", "numeric"),
               _c("region", "categorical"), _c("churned", "boolean", "target")],
              "binary", rows="m", w=(0.3, 0.55, 0.15), missing=True, file="customers.csv")
GRID = _spec([_c("timestamp", "datetime", "time"), _c("temp_c", "numeric", key=True, known=True),
              _c("is_workday", "boolean", known=True), _c("load_mw", "numeric", "target")],
             "forecast", "H", 48, "l", (0.7, 0.05, 0.25), file="grid_load_hourly.csv")
RENT = _spec([_c("listing_id", "id", "ignore"), _c("city", "categorical", key=True), _c("sqm", "numeric", key=True),
              _c("rooms", "numeric"), _c("floor", "numeric"), _c("has_balcony", "boolean"), _c("year_built", "numeric"),
              _c("description", "text"), _c("rent_eur", "numeric", "target")],
             "regression", rows="m", w=(0.6, 0.2, 0.2), missing=True, file="listings.csv")
ICECREAM = _spec([_c("month", "datetime", "time"), _c("units", "numeric", "target")],
                 "forecast", "M", 12, "xs", (0.4, 0.4, 0.2), intervals=True, file="icecream_monthly.csv")
WINE = _spec([_c("fixed_acidity", "numeric"), _c("volatile_acidity", "numeric", key=True), _c("citric_acid", "numeric"),
              _c("residual_sugar", "numeric"), _c("chlorides", "numeric"), _c("sulphates", "numeric"),
              _c("alcohol", "numeric", key=True), _c("quality_band", "categorical", "target")],
             "multiclass", rows="s", w=(0.5, 0.3, 0.2), file="wine.csv")
SESSIONS = _spec([_c("date", "datetime", "time"), _c("campaign_spend", "numeric", key=True, known=True),
                  _c("sessions", "numeric", "target")],
                 "forecast", "D", 30, "s", (0.4, 0.4, 0.2), intervals=True, file="web_sessions.csv")
SENSOR = _spec([_c("hours_since_calibration", "numeric", key=True), _c("ambient_temp", "numeric"),
                _c("humidity", "numeric"), _c("drift_mv", "numeric", "target")],
               "regression", rows="xs", w=(0.4, 0.3, 0.3), intervals=True, file="sensor_drift.csv")
FRAUD = _spec([_c("txn_id", "id", "ignore"), _c("amount_eur", "numeric", key=True), _c("merchant_category", "categorical"),
               _c("country", "categorical"), _c("hour_of_day", "numeric"), _c("km_from_home", "numeric", key=True),
               _c("card_present", "boolean"), _c("is_fraud", "boolean", "target")],
              "anomaly", rows="l", w=(0.5, 0.25, 0.25), tune=True, file="transactions.csv")
SEGMENTS = _spec([_c("customer_id", "id", "ignore"), _c("age", "numeric"), _c("annual_income_k", "numeric"),
                  _c("visits_per_month", "numeric", key=True), _c("avg_basket_eur", "numeric", key=True),
                  _c("channel", "categorical"), _c("loyalty_member", "boolean")],
                 "cluster", rows="m", w=(0.3, 0.5, 0.2), file="customers.csv")

# (author index, title, model, spec, notes, tags, cites, days ago)
DEMO_SNIPPETS = [
    (1, "Card fraud screening (isolation forest, tuned)", "iforest", FRAUD,
     "Unsupervised scores for every transaction; the 1,200 confirmed fraud cases are only used to measure it and to "
     "tune it with Optuna (average precision). The top 0.5% goes to the review queue each morning.",
     ["anomaly", "fraud", "optuna"], 5, 2),
    (3, "Customer segments with k-means", "kmeans", SEGMENTS,
     "k chosen by silhouette (it picked 5). The profile table named itself: weekend families, app regulars, "
     "big-basket monthly, students, lapsed.", ["clustering", "segmentation", "retail"], 6, 4),
    (2, "Zero-shot hourly load with Chronos-2", "chronos", GRID,
     "Benchmark before training anything: Chronos-2 with temperature as a known-ahead covariate, no training at all. "
     "It landed within 4% of the LSTM's MASE.", ["energy", "foundation-model", "zero-shot"], 4, 1),
    (0, "Bakery loaves: 14-day forecast per shop", "lgbm", BAKERY,
     "One global LightGBM model across all 9 shops, with lags 1/7/14/28 and rolling means. Promo and holidays are "
     "planned ahead, so they enter as known-future features. Beat seasonal naive by ~31% MAE on the last 14 days.",
     ["retail", "daily", "global-model"], 14, 3),
    (1, "Churn early-warning (interpretable baseline)", "logreg", CHURN,
     "Start here before anything fancy: L2 logistic regression with one-hot plans and scaled numerics. The coefficients "
     "go straight into the account managers' slide deck.", ["churn", "baseline", "saas"], 9, 6),
    (1, "Churn early-warning, CatBoost edition", "catboost", CHURN,
     "Same data description, CatBoost with native categoricals. +0.04 ROC AUC over the logistic baseline; SHAP plots "
     "agree that support tickets dominate.", ["churn", "boosting"], 6, 5),
    (2, "Hourly grid load, 48 h ahead (LSTM)", "lstm", GRID,
     "Sequence model on a 168-hour window. Temperature forecasts are known ahead. Train on GPU if you have one; "
     "CPU takes ~20 min on 3 years of hourly data.", ["energy", "hourly", "deep-learning"], 11, 9),
    (3, "Apartment rent estimator", "xgb", RENT,
     "XGBoost on listing features plus TF-IDF of the description (\"renovated\", \"view\" carry real signal). "
     "Log-transform the target if your rents are very skewed.", ["real-estate", "tabular", "text"], 7, 12),
    (0, "Ice-cream units: seasonal ARIMA with intervals", "arima", ICECREAM,
     "Eight years of monthly data, so the classics shine. SARIMA(1,1,1)(1,1,1)12 with 80/95% intervals for the "
     "purchasing team.", ["seasonal", "monthly", "classical"], 5, 20),
    (1, "Wine quality bands (random forest)", "rf", WINE,
     "Three bands (low/mid/high). Random forest with balanced class weights; permutation importance puts alcohol "
     "and volatile acidity on top.", ["classification", "tabular"], 4, 27),
    (2, "Web sessions with Prophet + campaign spend", "prophet", SESSIONS,
     "Prophet with weekly + yearly seasonality and campaign spend as an extra regressor. Good enough for the "
     "marketing calendar, and the components plot explains itself.", ["marketing", "daily"], 8, 15),
    (3, "Sensor drift with a Gaussian process", "gp", SENSOR,
     "Only 180 calibration runs, so a GP with an RBF + white-noise kernel gives honest uncertainty bands. "
     "Predictive std goes into the maintenance schedule.", ["small-data", "uncertainty", "iot"], 3, 33),
]
# Tables that hold demo rows (each has an is_demo column). Children before parents.
DEMO_TABLES = ["snippets", "datasets"]


def state():
    return C.get_setting("demo", "never")  # "never" | "loaded" | "removed"


def ensure_loaded():
    """Call from the app's main data callables: loads the demo once, unless an admin removed it."""
    if state() == "never":
        load()


def load():
    remove(remember=False)
    users = []
    for name, email in DEMO_USERS:
        u = app_tables.users.get(email=email) or app_tables.users.add_row(email=email, enabled=False)
        u.update(display_name=name, is_demo=True, signed_up=C.now() - dt.timedelta(days=60))
        users.append(u)
    for who, title, model, spec, notes, tags, cites, days in DEMO_SNIPPETS:
        when = C.now() - dt.timedelta(days=days, hours=who * 3)
        app_tables.snippets.add_row(owner=users[who], title=title, model=model, task=spec["task"], spec=spec, files=None,
                                    notes=notes, tags=tags, starred=False, is_public=True, cites=cites, forked_from=None,
                                    created=when, updated=when, is_demo=True)
    C.set_setting("demo", "loaded")
    return counts()


def remove(remember=True):
    demo = list(app_tables.snippets.search(is_demo=True))
    for r in app_tables.snippets.search(is_demo=False):
        if r["forked_from"] is not None and r["forked_from"] in demo:
            r["forked_from"] = None  # real forks of demo listings keep their code, lose the link
    for name in DEMO_TABLES:
        for r in getattr(app_tables, name).search(is_demo=True):
            r.delete()
    for u in app_tables.users.search(is_demo=True):
        u.delete()
    if remember:
        C.set_setting("demo", "removed")
    return counts()


def counts():
    out = {"users": len(app_tables.users.search(is_demo=True))}
    for name in DEMO_TABLES:
        out[name] = len(getattr(app_tables, name).search(is_demo=True))
    return out
