"""Read my results: what train.py printed -> a plain verdict. Pure Python (only `re`), no anvil imports, so the
browser runs it (Pages/Results) and a desktop Python can load it by path.

    m = parse(text)            the numbers RoboIntern's listings print (every template: tabular, forecast, anomaly,
                               clusters), as a dict; m["found"] = how many lines were recognised (0 = not our output)
    items = read(m, ctx)       findings [{level, title, text, href, link}], level "bad" | "warn" | "good" | "info"
    head = headline(m, items, ctx)   the verdict on top: {level, title, text}
    summary(m, head)           one short line for a listing's notes ("Add to notes")
ctx = {task, model, target, title} from the page that sent the person here (all optional).
Rules: skill <= 0 is bad; accuracy within 2 points of always-the-majority is the imbalance trap; AUC < 0.55 is a coin
flip; AUC >= 0.98, R^2 >= 0.98 or skill >= 95% is too good (leak check); MASE >= 1 means seasonal naive wins; coverage
under 80% of a 90% target is too narrow; one importance > 5x the next means one column carries the model; negative
importances are noise columns; under 500 holdout rows, prefer k-fold.
"""
import re

NUM = r"([-+]?(?:\d[\d,]*)?\.?\d+(?:[eE][-+]?\d+)?)"
LEAK_HREF = "#lab"

EXAMPLES = {
    "regression": """1,840 rows, rent_eur: mean 1,012.400, sd 318.250

Holdout (368 rows):
  MAE   171.2210   (predicting the mean: 222.5170, skill +23.1%)
  RMSE  236.0420
  R^2   0.4410

What the model leans on:
  sqm                              +88.4120  (key driver)
  city                             +41.0230  (key driver)
  rooms                            +12.7710
  year_built                        +6.0130
  has_balcony                       +1.2060
  floor                             -0.4410
  90% interval: prediction +/- 402.1180

Saved model.joblib. Next: python predict.py new.csv""",
    "binary": """5,000 rows, classes: ['no', 'yes']  (positive = 'yes')

Holdout (1,000 rows):
  accuracy           0.9100   (always 'no': 0.9000)
  balanced accuracy  0.5480
  F1 (macro)         0.5630
  ROC AUC            0.6620   (0.5 = coin flip)
  log loss           0.3010

What the model leans on:
  support_tickets_90d              +0.0310  (key driver)
  last_login_days                  +0.0220
  plan                             +0.0090  (key driver)
  region                           -0.0020

Saved model.joblib. Next: python predict.py new.csv""",
    "leaky": """12,400 rows, classes: ['no', 'yes']  (positive = 'yes')

Holdout (2,480 rows):
  accuracy           0.9980   (always 'no': 0.8410)
  balanced accuracy  0.9960
  F1 (macro)         0.9950
  ROC AUC            0.9990   (0.5 = coin flip)
  log loss           0.0090

What the model leans on:
  churn_reason                     +0.4810
  support_tickets_90d              +0.0120
  monthly_spend                    +0.0040

Saved model.joblib. Next: python predict.py new.csv""",
    "forecast": """1,260 rows, 3 series, holdout from 2026-03-18

Holdout: last 14 periods of 3 series
  MAE    11.8420   (seasonal naive: 14.6100, skill +18.9%)
  RMSE   15.2210
  sMAPE  8.41%
  MASE   0.811   (< 1 beats the naive benchmark)
  interval coverage 72.0% (target 90%)

Saved model.joblib. Next: python predict.py""",
}
EXAMPLE_ORDER = ["regression", "binary", "leaky", "forecast"]


def _f(s):
    try:
        return float(str(s).replace(",", ""))
    except Exception:
        return None


def _search(pattern, text):
    return re.search(pattern, text, re.M)


def parse(text):
    """The numbers in a listing's printout. Unknown lines are skipped; nothing raises."""
    t = (text or "").replace("\r\n", "\n").replace("\r", "\n")
    m = {"found": 0, "importances": []}

    def grab(key, pattern, group=1, conv=_f):
        hit = _search(pattern, t)
        if hit:
            v = conv(hit.group(group))
            if v is not None:
                m[key] = v
                m["found"] += 1
                return hit
        return None

    grab("rows", r"^\s*([\d,]+) rows")
    grab("groups", r"([\d,]+) groups in \[")
    grab("holdout_rows", r"Holdout \(([\d,]+) rows\)")
    hit = _search(r"Holdout: last (\d+) periods of ([\d,]+) series", t)
    if hit:
        m["horizon"], m["series"] = _f(hit.group(1)), _f(hit.group(2))
        m["found"] += 1
    # regression / forecast errors
    hit = grab("mae", r"^\s*MAE\s+" + NUM + r"\s+\(predicting the mean:\s*" + NUM + r",\s*skill\s*" + NUM + "%")
    if hit:
        m["mae_base"], m["skill"], m["base"] = _f(hit.group(2)), _f(hit.group(3)), "mean"
    else:
        hit = grab("mae", r"^\s*MAE\s+" + NUM + r"\s+\(seasonal naive:\s*" + NUM + r",\s*skill\s*" + NUM + "%")
        if hit:
            m["mae_base"], m["skill"], m["base"] = _f(hit.group(2)), _f(hit.group(3)), "naive"
        else:
            grab("mae", r"^\s*MAE\s+" + NUM)
    grab("rmse", r"^\s*RMSE\s+" + NUM)
    grab("r2", r"^\s*R\^2\s+" + NUM)
    grab("smape", r"^\s*sMAPE\s+" + NUM)
    grab("mase", r"^\s*MASE\s+" + NUM)
    hit = grab("coverage", r"interval coverage\s+" + NUM + "%")
    if hit:
        tg = _search(r"interval coverage\s+" + NUM + r"%\s*\(target\s+(\d+)%\)", t)
        if tg:
            m["coverage_target"] = _f(tg.group(2))
    hit = _search(r"(\d+)% (?:conformal )?interval: (?:prediction|forecast) \+/-\s*" + NUM, t)
    if hit:
        m["band_level"], m["band"] = _f(hit.group(1)), _f(hit.group(2))
        m["found"] += 1
    # classification
    hit = grab("accuracy", r"^\s*accuracy\s+" + NUM + r"\s+\(always '([^']*)':\s*" + NUM + r"\)")
    if hit:
        m["majority_label"], m["majority"] = hit.group(2), _f(hit.group(3))
    grab("bal_acc", r"^\s*balanced accuracy\s+" + NUM)
    grab("f1", r"^\s*F1 \(macro\)\s+" + NUM)
    hit = grab("auc", r"^\s*ROC AUC(?: \(ovr\))?\s+" + NUM)
    if hit and "(ovr)" in hit.group(0):
        m["multiclass"] = True
    grab("logloss", r"^\s*log loss\s+" + NUM)
    hit = _search(r"classes: \[([^\]]*)\]", t)
    if hit:
        m["n_classes"] = len([c for c in hit.group(1).split(",") if c.strip()])
        m["found"] += 1
    # anomaly detection
    hit = grab("pr_auc", r"PR AUC \(AP\)\s+" + NUM + r"\s+\(random:\s*" + NUM + r"\)")
    if hit:
        m["pr_random"] = _f(hit.group(2))
    hit = grab("precision_k", r"precision@(\d+)\s*" + NUM, group=2)
    if hit:
        m["k"] = _f(hit.group(1))
    hit = grab("labelled", r"([\d,]+) labelled anomalies \(" + NUM + "%")
    if hit:
        m["labelled_pct"] = _f(hit.group(2))
    hit = grab("flag_precision", r"flagged rows:\s*" + NUM + r"% are real anomalies; they catch\s*" + NUM + "%")
    if hit:
        m["flag_recall"] = _f(hit.group(2))
    grab("flagged", r"Flagged ([\d,]+) rows: the top")
    hit = grab("flagged", r"flagged ([\d,]+) \(" + NUM + r"%\) with \|z\|")
    if hit:
        m["flagged_pct"] = _f(hit.group(2))
        m["over_time"] = True
    # clustering
    hit = grab("clusters", r"^(\d+) clusters")
    if hit:
        nz = _search(r"^\d+ clusters, ([\d,]+) rows left as noise", t)
        m["noise"] = _f(nz.group(1)) if nz else 0
    grab("silhouette", r"^\s+silhouette\s+" + NUM)
    grab("davies", r"^\s*Davies-Bouldin\s+" + NUM)
    # tuning: the best cross-validated score
    hit = _search(r"best CV (\w+)\s+" + NUM + r" after (\d+) trials", t)
    if hit:
        m["cv_metric"], m["cv_score"] = hit.group(1), _f(hit.group(2))
        m["found"] += 1
    # "What the model leans on": permutation importances
    block = _search(r"What the model leans on:\n((?:[ \t]+\S[^\n]*\n?)+)", t)
    if block:
        for line in block.group(1).split("\n"):
            hit = re.match(r"^\s+(.+?)\s+([-+]\d[\d.]*(?:[eE][-+]?\d+)?)(\s+\(key driver\))?\s*$", line)
            if hit:
                m["importances"].append({"name": hit.group(1).strip(), "value": _f(hit.group(2)) or 0.0,
                                         "key": bool(hit.group(3))})
        if m["importances"]:
            m["found"] += 1
    m["kind"] = _kind(m)
    return m


def _kind(m):
    if "accuracy" in m or "bal_acc" in m:
        return "classification"
    if m.get("base") == "naive" or "mase" in m or "series" in m:
        return "forecast"
    if "mae" in m or "r2" in m:
        return "regression"
    if "pr_auc" in m or "flagged" in m or "labelled" in m:
        return "anomaly"
    if "clusters" in m or "silhouette" in m:
        return "cluster"
    return ""


def _pct(x, digits=0):
    return ("%." + str(digits) + "f%%") % x


def _item(level, title, text, href="", link=""):
    return {"level": level, "title": title, "text": text, "href": href, "link": link}


def read(m, ctx=None):
    """The findings, worst first."""
    ctx = ctx or {}
    out = []
    kind = m.get("kind") or ""
    n = m.get("holdout_rows")
    # ---- too good to be true (supervised tasks only: a label only measures an anomaly detector)
    too = []
    if kind == "classification" and m.get("auc") is not None and m["auc"] >= 0.98:
        too.append("ROC AUC %.3f" % m["auc"])
    if kind == "classification" and m.get("auc") is None and m.get("bal_acc") is not None and m["bal_acc"] >= 0.98:
        too.append("balanced accuracy %.3f" % m["bal_acc"])
    if kind == "regression" and m.get("r2") is not None and m["r2"] >= 0.98:
        too.append("R² %.3f" % m["r2"])
    if kind in ("regression", "forecast") and m.get("skill") is not None and m["skill"] >= 95:
        too.append("skill %+.1f%%" % m["skill"])
    if too:
        out.append(_item("bad", "Too good to be true: " + ", ".join(too),
                         "Real data is noisy. A score this close to perfect usually means a column gives the answer away "
                         "(recorded after the outcome, or computed from the target), or the same customer, patient or "
                         "machine sits in both training and testing. Run the leak check before you trust it.",
                         LEAK_HREF, "Open the Lab's leak check"))
    # ---- regression / forecast skill
    sk = m.get("skill")
    if sk is not None and not too:
        base = "the seasonal naïve forecast" if m.get("base") == "naive" else "predicting the mean"
        if sk <= 0:
            out.append(_item("bad", "No better than " + base + " (skill %+.1f%%)" % sk,
                             "The model's typical miss (MAE) is as big as, or bigger than, the miss of " + base + ". "
                             "It hasn't learned anything useful yet: check that the features are known before the "
                             "outcome and actually relate to it, and that the target column is the right one.",
                             "#atlas/metric/mae", "Atlas: MAE"))
        elif sk < 10:
            out.append(_item("warn", "Only a little better than " + base + " (skill %+.1f%%)" % sk,
                             "It beats the simple baseline, but not by much. Better features usually help more than a "
                             "fancier model: the drivers you know matter (★ in the Lab), and outside signals.",
                             "#atlas/feature/known" if m.get("base") == "naive" else "#atlas/feature/interactions",
                             "Atlas: feature development"))
        else:
            out.append(_item("good", "Beats " + base + " by %.0f%%" % sk,
                             "Its typical miss (MAE %s) is %.0f%% smaller than the baseline's (%s). That is a real "
                             "signal." % (_short(m.get("mae")), sk, _short(m.get("mae_base"))),
                             "#atlas/metric/mae", "Atlas: MAE"))
    r2 = m.get("r2")
    if r2 is not None and r2 < 0 and kind == "regression" and (sk is None or sk > 0):
        out.append(_item("bad", "R² below zero (%.3f)" % r2,
                         "Predicting the average for every row would explain the holdout better than the model does.",
                         "#atlas/metric/r2", "Atlas: R²"))
    # ---- forecasting: MASE, intervals
    mase = m.get("mase")
    if mase is not None:
        if mase >= 1:
            out.append(_item("bad", "Seasonal naïve wins (MASE %.2f)" % mase,
                             "MASE at or above 1 means repeating last season's value beats the model. Keep the simple "
                             "forecast, or give the model drivers that know something the calendar doesn't.",
                             "#atlas/metric/mase", "Atlas: MASE"))
        elif not too:
            out.append(_item("good", "Beats seasonal naïve (MASE %.2f)" % mase,
                             "Below 1 is the bar every forecast has to clear, and this one does.",
                             "#atlas/metric/mase", "Atlas: MASE"))
    cov = m.get("coverage")
    if cov is not None:
        target = m.get("coverage_target") or (80.0 if (ctx.get("model") or "") == "qgbm" else 90.0)
        if cov < target - 10:
            out.append(_item("warn", "Intervals too narrow: %s coverage against a %s target" % (_pct(cov), _pct(target)),
                             "Fewer actual values land inside the band than promised, so the model is more sure of "
                             "itself than it should be. Widen it (conformal intervals do that from the holdout errors).",
                             "#atlas/metric/coverage", "Atlas: interval coverage"))
        elif cov > min(99.5, target + 8):
            out.append(_item("info", "Intervals on the wide side: %s coverage for a %s target" % (_pct(cov), _pct(target)),
                             "Safe, but the band could be tighter: check its average width before you plan with it.",
                             "#atlas/metric/coverage", "Atlas: interval coverage"))
        else:
            out.append(_item("good", "Intervals keep their promise: %s against a %s target" % (_pct(cov), _pct(target)),
                             "The band holds about as many actual values as it should.", "#atlas/metric/coverage",
                             "Atlas: interval coverage"))
    # ---- classification
    acc, maj = m.get("accuracy"), m.get("majority")
    if acc is not None and maj is not None and acc - maj <= 0.02 and not too:
        out.append(_item("bad", "Mostly predicts the majority class",
                         "Accuracy %.3f against %.3f for always saying '%s': the model barely beats the lazy answer. "
                         "With imbalanced classes look at balanced accuracy and PR AUC instead, and at how many of the "
                         "rare cases it catches." % (acc, maj, m.get("majority_label") or "the majority"),
                         "#atlas/metric/prauc", "Atlas: PR AUC"))
    auc = m.get("auc")
    if auc is not None and kind == "classification" and not too:
        if auc < 0.55:
            out.append(_item("bad", "Coin flip (ROC AUC %.3f)" % auc,
                             "0.5 is guessing. The features don't separate the classes yet: check the target and the "
                             "columns you marked as features.", "#atlas/metric/auc", "Atlas: ROC AUC"))
        elif auc < 0.7:
            out.append(_item("warn", "Weak signal (ROC AUC %.3f)" % auc,
                             "Better than guessing, but it ranks many cases the wrong way round. Useful for a rough "
                             "priority list, not for decisions on single cases.", "#atlas/metric/auc", "Atlas: ROC AUC"))
        elif auc < 0.8:
            out.append(_item("good", "Some real signal (ROC AUC %.3f)" % auc,
                             "It ranks a random positive above a random negative %.0f%% of the time. Usable with care: "
                             "pick the decision threshold from what a miss and a false alarm cost." % (auc * 100),
                             "#atlas/metric/auc", "Atlas: ROC AUC"))
        else:
            out.append(_item("good", "Ranks cases well (ROC AUC %.3f)" % auc,
                             "It ranks a random positive above a random negative %.0f%% of the time." % (auc * 100),
                             "#atlas/metric/auc", "Atlas: ROC AUC"))
    ba, k = m.get("bal_acc"), m.get("n_classes")
    if ba is not None and auc is None and k and k > 2 and not too:
        chance = 1.0 / k
        if ba <= chance + 0.05:
            out.append(_item("bad", "About as good as guessing (balanced accuracy %.3f)" % ba,
                             "With %d classes, guessing gets about %.2f." % (k, chance), "#atlas/metric/accuracy",
                             "Atlas: balanced accuracy"))
    # ---- anomaly detection against labels
    ap, rnd = m.get("pr_auc"), m.get("pr_random")
    if ap is not None and rnd:
        lift = ap / rnd if rnd else 0
        if lift < 2:
            out.append(_item("warn", "The detector barely beats chance (PR AUC %.3f, random %.3f)" % (ap, rnd),
                             "Its most unusual rows are hardly more often real anomalies than random rows. Add columns "
                             "that describe what makes a case odd (amount vs the person's usual, velocity, distance).",
                             "#atlas/metric/prauc", "Atlas: PR AUC"))
        else:
            out.append(_item("good", "Finds real anomalies: PR AUC %.0f× random" % lift,
                             "PR AUC %.3f against %.3f by chance. Check precision@%d: it is what a reviewer feels."
                             % (ap, rnd, int(m.get("k") or 0)), "#atlas/metric/precision-k", "Atlas: precision@k"))
    if m.get("flagged_pct") is not None and m["flagged_pct"] > 5:
        out.append(_item("warn", "Many flags: %s of rows" % _pct(m["flagged_pct"], 1),
                         "Nobody reviews that many. Raise the |z| threshold Z in train.py until the flags fit a day's "
                         "work.", "#atlas/metric/precision-k", "Atlas: precision@k"))
    # ---- clustering
    sil = m.get("silhouette")
    if sil is not None:
        if sil < 0.25:
            out.append(_item("warn", "Weak structure (silhouette %.2f)" % sil,
                             "The clusters overlap a lot: treat them as a convenient split, not as natural groups. Try "
                             "fewer columns, or scale and log-transform skewed ones.", "#atlas/metric/silhouette",
                             "Atlas: silhouette"))
        elif sil < 0.5:
            out.append(_item("good", "Reasonable structure (silhouette %.2f)" % sil,
                             "The groups are distinct enough to name and treat differently.", "#atlas/metric/silhouette",
                             "Atlas: silhouette"))
        else:
            out.append(_item("good", "Clear structure (silhouette %.2f)" % sil,
                             "Tight, well separated groups.", "#atlas/metric/silhouette", "Atlas: silhouette"))
    if m.get("noise") and m.get("rows") and m["noise"] / m["rows"] > 0.3:
        out.append(_item("warn", "A lot of noise: %s of rows fit no cluster" % _pct(100.0 * m["noise"] / m["rows"]),
                         "Lower min_cluster_size, or accept that many rows are simply in between.",
                         "#atlas/model/hdbscan", "Atlas: HDBSCAN"))
    # ---- tuning vs holdout
    cvm, cvs = m.get("cv_metric"), m.get("cv_score")
    if cvm == "roc_auc" and cvs is not None and auc is not None and cvs - auc > 0.05:
        out.append(_item("warn", "Holdout well below cross-validation (%.3f vs %.3f)" % (auc, cvs),
                         "The search may have fitted the folds, or the holdout rows differ from the training rows (a "
                         "time split shows drift this way).", "#atlas/validation/nested", "Atlas: nested CV"))
    if cvm == "neg_mean_absolute_error" and cvs is not None and m.get("mae") and -cvs > 0 and m["mae"] > 1.25 * -cvs:
        out.append(_item("warn", "Holdout error well above cross-validation (MAE %s vs %s)" % (_short(m["mae"]), _short(-cvs)),
                         "The search may have fitted the folds, or the holdout rows differ from the training rows.",
                         "#atlas/validation/nested", "Atlas: nested CV"))
    # ---- what the model leans on
    imp = sorted(m.get("importances") or [], key=lambda x: -x["value"])
    if len(imp) >= 2 and imp[0]["value"] > 0:
        top, nxt = imp[0], imp[1]
        if nxt["value"] <= 0 or top["value"] > 5 * nxt["value"]:
            out.append(_item("bad" if too else "warn", "One column carries the model: %s" % top["name"],
                             "Its importance (%+.4f) dwarfs the next one (%s, %+.4f). Was %s known before the outcome? "
                             "If it is recorded afterwards, or computed from the target, it is a leak; if it is "
                             "genuinely known, the model is fragile when that column is missing."
                             % (top["value"], nxt["name"], nxt["value"], top["name"]), LEAK_HREF,
                             "Open the Lab's leak check"))
    neg = [x["name"] for x in imp if x["value"] < 0]
    if neg:
        out.append(_item("info", "Noise columns: " + ", ".join(neg[:4]) + (" …" if len(neg) > 4 else ""),
                         "Shuffling them made the score slightly better, so they add nothing on this holdout. Dropping "
                         "them makes the model simpler; a few small negatives are normal.",
                         "#atlas/feature/scaling", "Atlas: feature development"))
    # ---- how sure is the number?
    if n is not None and n < 500:
        extra = ""
        if acc is not None:
            se = (acc * (1 - acc) / max(n, 1)) ** 0.5
            extra = " With %d rows, accuracy alone is uncertain by about ±%.1f points (95%%)." % (n, 196 * se)
        out.append(_item("info", "Small holdout: %d rows" % n,
                         "One split of a few hundred rows is noisy: rerun with another seed and the score moves. "
                         "Prefer k-fold cross-validation, or tick tuning in the Lab, which adds it." + extra,
                         "#atlas/validation/kfold", "Atlas: k-fold cross-validation"))
    if m.get("groups") and kind in ("classification", "regression"):
        out.append(_item("good", "Group-aware split: %d groups" % m["groups"],
                         "Each group's rows sat on one side of the split, so the score is for new groups, not ones the "
                         "model has seen.", "#atlas/validation/group", "Atlas: group k-fold"))
    order = {"bad": 0, "warn": 1, "good": 2, "info": 3}
    out.sort(key=lambda x: order[x["level"]])
    return out


def _commas(x):
    """12345.6 -> '12,346' (written out: the browser's Python may not know the ',' format option)."""
    s = "%d" % int(round(x))
    sign, s = ("-", s[1:]) if s.startswith("-") else ("", s)
    parts = []
    while len(s) > 3:
        parts.insert(0, s[-3:])
        s = s[:-3]
    parts.insert(0, s)
    return sign + ",".join(parts)


def _short(x):
    if x is None:
        return "?"
    a = abs(x)
    if a >= 1000:
        return _commas(x)
    if a >= 10:
        return "%.1f" % x
    return "%.3g" % x


def headline(m, items, ctx=None):
    """The verdict on top of the page."""
    ctx = ctx or {}
    if not m.get("found") or not m.get("kind"):
        return {"level": "info", "title": "Nothing to read yet",
                "text": "Paste everything train.py printed, from the first line (“1,234 rows …”) to "
                        "“Saved model.joblib”. RoboIntern's listings print their scores in a fixed format; "
                        "this page reads that format."}
    titles = [i["title"] for i in items]
    for i in items:
        if i["title"].startswith("Too good to be true"):
            return {"level": "bad", "title": "Suspiciously good: run the leak check first",
                    "text": "A near-perfect score on real data is almost always a leak, not a breakthrough."}
    kind = m["kind"]
    if kind == "classification":
        if any(t.startswith("Mostly predicts the majority") for t in titles):
            return {"level": "bad", "title": "Mostly predicts the majority class",
                    "text": "Accuracy looks high only because one class is common. Judge it by balanced accuracy and PR AUC."}
        auc = m.get("auc")
        if auc is not None:
            if auc < 0.55:
                return {"level": "bad", "title": "Coin flip: no signal yet", "text": "ROC AUC %.3f; 0.5 is guessing." % auc}
            if auc < 0.7:
                return {"level": "warn", "title": "Weak signal: ROC AUC %.2f" % auc,
                        "text": "Better than guessing, not yet good enough for decisions on single cases."}
            return {"level": "good", "title": "Ranks cases well: ROC AUC %.2f, usable" % auc,
                    "text": "Choose the decision threshold from what a miss and a false alarm cost you."}
        ba = m.get("bal_acc")
        if ba is not None:
            return {"level": "good" if ba >= 0.6 else "warn", "title": "Balanced accuracy %.2f" % ba,
                    "text": "The average recall over the classes: 1 is perfect."}
    if kind in ("regression", "forecast"):
        sk = m.get("skill")
        if kind == "forecast" and m.get("mase") is not None and m["mase"] >= 1:
            return {"level": "bad", "title": "Seasonal naïve wins: keep the simple forecast",
                    "text": "MASE %.2f: repeating last season beats the model." % m["mase"]}
        if sk is not None:
            base = "the seasonal naïve forecast" if m.get("base") == "naive" else "predicting the mean"
            if sk <= 0:
                return {"level": "bad", "title": "No better than " + base, "text": "Skill %+.1f%%." % sk}
            if sk < 10:
                return {"level": "warn", "title": "Barely beats %s (%+.0f%%)" % (base, sk),
                        "text": "A real but small gain: features are the next lever."}
            return {"level": "good", "title": "Beats %s by %.0f%%: usable" % (base, sk),
                    "text": "MAE %s against %s for the baseline." % (_short(m.get("mae")), _short(m.get("mae_base")))}
        if m.get("r2") is not None:
            return {"level": "good" if m["r2"] > 0.2 else "warn", "title": "R² %.2f" % m["r2"],
                    "text": "The share of the variance the model explains on the holdout."}
    if kind == "anomaly":
        ap, rnd = m.get("pr_auc"), m.get("pr_random")
        if ap is not None and rnd:
            lift = ap / rnd
            return {"level": "good" if lift >= 2 else "warn",
                    "title": ("Finds real anomalies: %.0f× better than chance" % lift) if lift >= 2 else "Barely beats chance",
                    "text": "PR AUC %.3f; random would score %.3f." % (ap, rnd)}
        if m.get("flagged") is not None:
            return {"level": "info", "title": "%s rows flagged: review them by hand" % _commas(m["flagged"]),
                    "text": "No labels to score against, so the proof is a person reading the top of anomalies.csv."}
    if kind == "cluster":
        sil = m.get("silhouette")
        if sil is not None:
            return {"level": "good" if sil >= 0.25 else "warn",
                    "title": "%d clusters, silhouette %.2f" % (int(m.get("clusters") or 0), sil),
                    "text": "Name each cluster from its profile before you act on it."}
    return {"level": "info", "title": "Read, with a few numbers", "text": "See the notes below."}


def summary(m, head, day=""):
    """One line for a listing's notes."""
    bits = []
    for key, label, fmt in (("mae", "MAE", "%s"), ("skill", "skill", "%+.1f%%"), ("r2", "R^2", "%.3f"),
                            ("mase", "MASE", "%.3f"), ("accuracy", "accuracy", "%.3f"), ("bal_acc", "balanced acc", "%.3f"),
                            ("auc", "ROC AUC", "%.3f"), ("pr_auc", "PR AUC", "%.3f"), ("silhouette", "silhouette", "%.3f")):
        if m.get(key) is not None:
            bits.append(label + " " + (_short(m[key]) if fmt == "%s" else fmt % m[key]))
    n = m.get("holdout_rows")
    return ("Results%s: %s. %s%s" % ((" " + day) if day else "", head["title"], ", ".join(bits[:5]),
                                     (" (holdout %d rows)" % n) if n else "")).strip()
