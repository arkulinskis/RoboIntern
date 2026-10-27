"""The data description ("spec") that the Lab builds and the code generator reads, cleaned for storage.

A spec never holds sample values: only column names, their types and roles, and the task settings.
    {"columns": [{"name", "type", "role", "key", "known"}], "task", "freq", "horizon", "rows",
     "weights": {"acc", "interp", "speed"}, "intervals", "missing", "file"}
Kept in step with RI.cleanSpec in web/pages/_engine.html.
"""
import re

from . import common as C

TYPES = ("numeric", "categorical", "datetime", "boolean", "text", "id")
ROLES = ("feature", "target", "time", "group", "ignore")
TASKS = ("forecast", "regression", "binary", "multiclass")
FREQS = ("H", "D", "W", "M", "Q", "Y")
ROWS = ("xs", "s", "m", "l", "xl")
FILES = ("train", "predict", "requirements")
MAX_COLUMNS = 400
MAX_FILE = 80000


def _num(v, lo, hi, dflt):
    try:
        v = float(v)
    except (TypeError, ValueError):
        return dflt
    if v != v:  # NaN
        return dflt
    return max(lo, min(hi, v))


def clean_spec(spec):
    """A spec from the browser -> a safe spec, or None if it isn't one."""
    if not isinstance(spec, dict):
        return None
    cols, seen = [], set()
    for c in (spec.get("columns") or [])[:MAX_COLUMNS]:
        if not isinstance(c, dict):
            continue
        name = C.text(c.get("name"), 120)
        if not name or name in seen:
            continue
        seen.add(name)
        cols.append({"name": name,
                     "type": c.get("type") if c.get("type") in TYPES else "numeric",
                     "role": c.get("role") if c.get("role") in ROLES else "feature",
                     "key": bool(c.get("key")), "known": bool(c.get("known"))})
    w = spec.get("weights") if isinstance(spec.get("weights"), dict) else {}
    return {"columns": cols,
            "task": spec.get("task") if spec.get("task") in TASKS else "regression",
            "freq": spec.get("freq") if spec.get("freq") in FREQS else "D",
            "horizon": int(_num(spec.get("horizon"), 1, 1000, 14)),
            "rows": spec.get("rows") if spec.get("rows") in ROWS else "m",
            "weights": {k: round(_num(w.get(k), 0, 1, 1 / 3.0), 4) for k in ("acc", "interp", "speed")},
            "intervals": bool(spec.get("intervals")), "missing": bool(spec.get("missing")),
            "file": C.text(spec.get("file"), 120) or "data.csv"}


def clean_files(files):
    if files is None:
        return None
    if not isinstance(files, dict):
        return None
    out = {}
    for k in FILES:
        v = files.get(k)
        if isinstance(v, str):
            out[k] = v.replace("\r\n", "\n")[:MAX_FILE]
    return out or None


def clean_tags(tags):
    out = []
    for t in (tags if isinstance(tags, list) else [])[:8]:
        t = re.sub(r"[^a-z0-9+#._-]", "", C.text(t, 24).lower().replace(" ", "-"))
        if t and t not in out:
            out.append(t)
    return out


def clean_model(model):
    m = C.text(model, 40).lower()
    return m if re.fullmatch(r"[a-z0-9-]{2,40}", m) else None


def target_of(spec):
    for c in (spec or {}).get("columns") or []:
        if c.get("role") == "target":
            return c.get("name")
    return None
