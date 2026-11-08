"""Run the generated listings on synthetic data that matches each spec.

    node tools/testing/codegen/gen.js <outdir> [slug ...]
    <python with the ML libraries> tools/testing/codegen/run.py <outdir> [--nb] [name-filter ...]

--nb also runs each notebook.ipynb (its code cells as one script, %pip lines skipped). Tuned listings run with
TUNE_TRIALS = 3 (and TUNE_EPOCHS = 2) so the search stays quick.

For every folder: writes data.csv (and new.csv for tabular tasks), runs train.py then predict.py, and checks
that predict.py wrote its CSV. Prints PASS/FAIL per listing and the tail of the output on failure.
Needs numpy, pandas, scikit-learn, joblib, plus statsmodels, lightgbm, xgboost, catboost, prophet, torch
for the listings that use them (folders whose library is missing are reported as SKIP).
"""
import importlib.util
import json
import pathlib
import re
import subprocess
import sys
import time

import numpy as np
import pandas as pd

LIBS = {"statsmodels": "statsmodels", "lightgbm": "lightgbm", "xgboost": "xgboost", "catboost": "catboost",
        "prophet": "prophet", "torch": "torch", "scikit-learn": "sklearn", "optuna": "optuna",
        "chronos-forecasting": "chronos", "timesfm[torch]": "timesfm"}
FREQ = {"H": "h", "D": "D", "W": "W-MON", "M": "MS", "Q": "QS", "Y": "YS"}
PERIODS = {"H": 24 * 40, "D": 420, "W": 160, "M": 108, "Q": 48, "Y": 40}
rng = np.random.default_rng(7)
WORDS = "bright quiet renovated view garden river modern old spacious cosy loud central new".split()


def col_values(c, n):
    t = c["type"]
    if t == "numeric":
        return rng.normal(50, 15, n).round(2)
    if t == "boolean":
        return rng.choice(["true", "false"], n)
    if t == "categorical":
        return rng.choice(["alpha", "beta", "gamma", "delta"], n)
    if t == "datetime":
        return pd.Timestamp("2015-01-01") + pd.to_timedelta(rng.integers(0, 3000, n), unit="D")
    if t == "text":
        return [" ".join(rng.choice(WORDS, 6)) for _ in range(n)]
    return ["id%05d" % i for i in range(n)]


def tabular(spec, n=700):
    df = pd.DataFrame({c["name"]: col_values(c, n) for c in spec["columns"] if c["role"] != "target"})
    tgts = [c for c in spec["columns"] if c["role"] == "target"]
    nums = [c["name"] for c in spec["columns"] if c["type"] == "numeric" and c["role"] == "feature"]
    signal = sum(df[x] for x in nums) / max(len(nums), 1)
    if not tgts:
        return df, df.head(25)
    tgt = tgts[0]["name"]
    if spec["task"] == "anomaly":  # 3% odd rows, far out on the numeric columns
        odd = rng.random(n) < 0.03
        for x in nums:
            df.loc[odd, x] = df.loc[odd, x] * 4 + 120
        df[tgt] = np.where(odd, "true", "false")
    elif spec["task"] == "cluster":
        df[tgt] = rng.choice(["true", "false"], n)
    elif spec["task"] == "regression":
        df[tgt] = (signal * 3 + rng.normal(0, 5, n)).round(1)
    elif spec["task"] == "binary":
        df[tgt] = np.where(signal + rng.normal(0, 8, n) > signal.mean(), "yes", "no")
    else:
        df[tgt] = pd.qcut(signal + rng.normal(0, 4, n), 3, labels=["low", "mid", "high"]).astype(str)
    if spec.get("missing"):
        for x in nums[:1]:
            df.loc[rng.random(n) < 0.05, x] = np.nan
    return df, df.drop(columns=[tgt]).head(25)


def forecast(spec):
    time_c = [c for c in spec["columns"] if c["role"] == "time"][0]["name"]
    groups = [c["name"] for c in spec["columns"] if c["role"] == "group"]
    tgt = [c for c in spec["columns"] if c["role"] == "target"][0]["name"]
    n = PERIODS[spec["freq"]]
    times = pd.date_range("2020-01-01", periods=n, freq=FREQ[spec["freq"]])
    frames = []
    for g in (["S1", "S2", "S3"] if groups else [None]):
        d = pd.DataFrame({time_c: times})
        for gc in groups:
            d[gc] = g
        k = np.arange(n)
        season = {"H": 24, "D": 7, "W": 52, "M": 12, "Q": 4, "Y": 1}[spec["freq"]]
        y = 100 + 0.05 * k + 15 * np.sin(2 * np.pi * k / max(season, 2)) + rng.normal(0, 4, n)
        for c in spec["columns"]:
            if c["role"] != "feature":
                continue
            v = col_values(c, n)
            d[c["name"]] = v
            if c["type"] == "boolean":
                y = y + 12 * (np.asarray(v) == "true")
            elif c["type"] == "numeric":
                y = y + 0.2 * np.asarray(v, float)
        d[tgt] = np.maximum(y, 0).round(1)
        frames.append(d)
    return pd.concat(frames, ignore_index=True), None


def run(cmd, cwd, timeout):
    t = time.time()
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout, encoding="utf-8", errors="replace")
    return r.returncode, (r.stdout + r.stderr), time.time() - t


def main():
    sys.stdout.reconfigure(errors="replace")
    out = pathlib.Path(sys.argv[1])
    nb = "--nb" in sys.argv
    only = [a for a in sys.argv[2:] if not a.startswith("--")]
    fails = 0
    for d in sorted(p for p in out.iterdir() if p.is_dir()):
        if only and not any(f in d.name for f in only):
            continue
        spec = json.loads((d / "spec.json").read_text(encoding="utf-8"))
        reqs = [l.split(">=")[0] for l in (d / "requirements.txt").read_text().splitlines() if l and not l.startswith("#")]
        missing = [r for r in reqs if r in LIBS and importlib.util.find_spec(LIBS[r]) is None]
        if missing:
            print("SKIP %-28s (missing %s)" % (d.name, ", ".join(missing)), flush=True)
            continue
        over_time = spec["task"] == "forecast" or (spec["task"] == "anomaly" and any(c["role"] == "time" for c in spec["columns"]))
        df, new = forecast(spec) if over_time else tabular(spec)
        if new is None and spec["task"] == "anomaly" and "predict.py new.csv" in (d / "predict.py").read_text(encoding="utf-8"):
            new = df.head(25)  # a row detector on time-stamped data still scores new rows
        for f in ("train.py", "predict.py"):  # quick searches in tests
            t = (d / f).read_text(encoding="utf-8")
            t = re.sub(r"TUNE_TRIALS = \d+", "TUNE_TRIALS = 3", t)
            t = re.sub(r"TUNE_EPOCHS = \d+", "TUNE_EPOCHS = 2", t)
            (d / f).write_text(t, encoding="utf-8")
        df.to_csv(d / "data.csv", index=False)
        args = []
        if new is not None:
            new.to_csv(d / "new.csv", index=False)
            args = ["new.csv"]
        code, log, secs = run([sys.executable, "train.py"], d, 900)
        if code == 0:
            code2, log2, secs2 = run([sys.executable, "predict.py"] + args, d, 600)
            outfile = d / ("forecast.csv" if spec["task"] == "forecast" else "predictions.csv")
            if code2 == 0 and nb and (d / "notebook.ipynb").exists():
                cells = json.loads((d / "notebook.ipynb").read_text(encoding="utf-8"))["cells"]
                src = ["".join(c["source"]) for c in cells if c["cell_type"] == "code"]
                (d / "nb_run.py").write_text("\n\n".join(x for x in src if not x.startswith("%")), encoding="utf-8")
                code3, log3, _ = run([sys.executable, "nb_run.py"], d, 900)
                if code3 != 0:
                    code2, log2 = code3, log2 + "\n--- notebook ---\n" + log3
            if code2 == 0 and outfile.exists() and len(pd.read_csv(outfile)) > 0:
                res = pd.read_csv(outfile)
                bad = res.select_dtypes("number").isna().all().any() if len(res) else True
                if not bad:
                    print("PASS %-28s train %5.1fs  predict %4.1fs  -> %d rows" % (d.name, secs, secs2, len(res)), flush=True)
                    (d / "train.log").write_text(log, encoding="utf-8")
                    continue
                log2 += "\nan output column is all NaN:\n" + res.head().to_string()
            log = log + "\n--- predict.py ---\n" + log2
        fails += 1
        print("FAIL %-28s\n    %s" % (d.name, "\n    ".join(log.strip().splitlines()[-14:])), flush=True)
    print("\n%d failed" % fails)
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
