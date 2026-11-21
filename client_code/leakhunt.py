"""Leak Hunt (#leakhunt): a daily three-round "spot the leaky column" puzzle built from the Casebook. Pure Python
(no anvil imports): the page (Pages/LeakHunt) runs it in the browser, a desktop Python can load it by path.

    puzzle(day_iso, cases)   the day's three rounds; the same date gives the same puzzle in every browser
                             (a small Lehmer LCG seeded from the day number). cases = RI.py.huntCases():
                             [{id, ind, ind_name, no, name, q, shape, shape_name, task, target, cols, all}]
    BANK                     the planted leaks: {shapes, col ({y} = the target, {stem} = its root), kind, why, known}
    record(st, day, today, score)   the browser's record after a finished puzzle: scores per day, streak, best
    streak_now(st, today)    the streak as it stands (0 after a missed day)
    share_line(day, score)   "RoboIntern Leak Hunt 2026-11-20: 2/3 · robointern.com/#leakhunt/2026-11-20"
    parse_record(text)       the record from the browser store (JSON text), or a fresh one
Each round: five real columns of the case (target and ignored ids left out) + one planted leak whose name never
collides with any column of the case.
"""
import datetime
import json

ROUNDS = 3
CHIPS = 6
SITE = "robointern.com"

KINDS = {
    "after": ("Recorded after the outcome", "#atlas/feature/known", "Atlas: known-ahead vs past-only"),
    "future": ("Looks into the future", "#atlas/feature/rolling", "Atlas: rolling windows"),
    "known": ("Ticked known ahead, but isn't", "#atlas/feature/known", "Atlas: known-ahead vs past-only"),
    "proxy": ("A copy of the target", "#atlas/feature/log", "Atlas: transforming the target"),
    "encoding": ("Target encoding on all rows", "#atlas/feature/target-enc", "Atlas: target encoding"),
}
BIN = ["risk", "propensity"]
REG = ["value", "quality", "duration"]
FC = ["demand", "load"]


def _b(shapes, col, kind, why, known=False):
    return {"shapes": shapes, "col": col, "kind": kind, "why": why, "known": known}


BANK = [
    # ---- will it happen? (event risk, propensity)
    _b(BIN, "{stem}_reason", "after", "A reason is written down only once it has happened. Rows where {y} is yes have one, the "
       "rest are blank, so the model learns “has a reason” instead of anything about the future."),
    _b(BIN, "{stem}_date", "after", "The date it happened exists only for the rows where it happened: blank means no, filled "
       "means yes. An answer key with a date on it."),
    _b(BIN, "days_until_{stem}", "after", "Counted backwards from the event itself. On the day you predict, nobody knows how "
       "many days are left."),
    _b(["propensity"], "cancellation_reason", "after", "Filled in when someone cancels. At prediction time it is empty for "
       "everyone, so it can't help then; in training it gives the answer away."),
    _b(BIN, "refund_amount", "after", "Refunds are paid after a cancellation, a return or a settled complaint: the money moves "
       "after the outcome you want to predict."),
    _b(["propensity"], "account_closed_flag", "after", "Closing the account is the last step of leaving. It is the outcome, "
       "renamed."),
    _b(["propensity"], "final_invoice_total", "after", "A final invoice is issued when a contract ends, so only leavers have one."),
    _b(["propensity"], "exit_survey_score", "after", "Only people who already left get the exit survey."),
    _b(["risk"], "collections_status", "after", "Accounts go to collections after they default: this column is written by the "
       "outcome."),
    _b(["risk"], "repair_ticket_closed", "after", "A repair ticket exists because the failure happened."),
    _b(BIN, "{stem}_next_30d_count", "future", "A “next 30 days” window ends in the future of the prediction: it counts "
       "the very events you want to predict."),
    _b(["risk"], "post_event_review", "after", "A review after the event is, by definition, written afterwards."),
    _b(["propensity"], "retention_offer_accepted", "after", "Retention offers go to people who already asked to leave; "
       "accepting one happens after the decision you want to predict."),
    _b(["risk"], "chargeback_filed", "after", "A chargeback is filed after a fraud or a dispute: it is the label, arriving late."),
    _b(BIN, "customer_{stem}_rate", "encoding", "The share of {y} per customer, computed on all rows: each row's own answer sits "
       "inside its feature. Compute it from earlier rows only, inside the training folds."),
    _b(["risk"], "claim_paid_amount", "after", "Paid when a claim is settled, so only rows where the event happened have it."),
    # ---- how much? (value, quality, duration)
    _b(REG, "log_{y}", "proxy", "It is {y} on a log scale: the model only has to undo the log."),
    _b(REG, "{y}_band", "proxy", "A banded copy of the target (low, mid, high), made from the answer itself."),
    _b(["value"], "{y}_per_unit", "proxy", "Divide the target by a size and you get this column; the model just multiplies it back."),
    _b(REG, "actual_{y}", "after", "The measured value of the target itself, under another name. It exists only afterwards."),
    _b(["value", "quality"], "{y}_rank", "proxy", "The rows ranked by the target itself."),
    _b(["quality"], "qc_pass_flag", "after", "Quality control passes or fails a batch after it is made, from the very result you "
       "predict."),
    _b(["quality"], "rework_hours", "after", "Rework happens after a bad result: its hours grow with the defect you're predicting."),
    _b(["duration"], "completed_at", "after", "The time it finished gives away how long it took."),
    _b(["duration"], "delivered_on_time", "after", "Known only once it arrived."),
    _b(["duration"], "days_open", "proxy", "How long the case stayed open is, nearly, the duration you predict."),
    _b(["value"], "invoice_paid_amount", "after", "Paid after the fact, and often equal to the value you predict."),
    _b(["value"], "adjuster_final_estimate", "after", "Set once the case is assessed: a near-copy of the final amount."),
    _b(REG, "category_avg_{y}", "encoding", "The mean of the target per category, computed on all rows, so each row's own answer "
       "is inside it. Target encoding has to be fitted on the training rows only."),
    # ---- which kind? (triage)
    _b(["triage"], "resolved_by_team", "after", "Which team resolved the case is the routing answer, recorded at the end."),
    _b(["triage"], "closing_note", "after", "Written when the case closes, and it usually names the category."),
    _b(["triage"], "resolution_code", "after", "The code entered at resolution: the label under another name."),
    _b(["triage"], "reassigned_count", "after", "Reassignments happen after the first routing; when a case arrives it is always 0."),
    _b(["triage"], "{y}_confirmed_by", "after", "Who confirmed the category: it only exists once the category is known."),
    # ---- how many, when? (demand, load)
    _b(FC, "{y}_7d_centred_avg", "future", "A centred 7-day average uses the 3 days after each date, so tomorrow's {y} sits "
       "inside today's feature."),
    _b(FC, "actual_temp_c", "known", "Ticked known ahead, but for the coming days you'll only have a temperature forecast. "
       "Train on the forecast (temp_fcst_c), or untick it so it enters as a lag.", True),
    _b(FC, "{y}_next_week", "future", "Next week's {y}, joined to this week's row: the answer, shifted."),
    _b(["demand"], "units_returned", "known", "Ticked known ahead, but returns arrive days after the sale: for the forecast days "
       "you don't have them yet.", True),
    _b(["demand"], "stockout_hours_actual", "known", "Ticked known ahead, but stock-outs are only counted after the day ends.", True),
    _b(["load"], "outage_minutes_actual", "known", "Ticked known ahead, but actual outages are known afterwards; only planned "
       "ones are known in advance.", True),
    _b(FC, "{y}_share_of_month", "future", "A share of the whole month's total: the month isn't over when you forecast."),
    _b(["load"], "realised_price", "known", "Ticked known ahead, but the realised price is only known after the hour; the "
       "day-ahead price is what you have.", True),
    _b(FC, "actual_arrivals", "known", "Ticked known ahead, but arrivals are counted on the day; ahead of time you only have "
       "a forecast of them.", True),
    _b(FC, "{y}_incl_today_avg", "future", "A rolling mean that includes today: on the morning you forecast, today isn't over."),
]

STEMS = {"churned": "churn", "churn": "churn", "defaulted": "default", "fails": "failure", "readmitted": "readmission",
         "canceled": "cancellation", "cancelled": "cancellation", "switched": "switch", "returned": "return",
         "lapsed": "lapse", "upgraded": "upgrade", "late": "delay", "defect": "defect", "no_show": "no_show",
         "took_offer": "offer", "deteriorates": "deterioration", "breaks": "breakdown", "buys": "purchase",
         "recovered": "recovery", "cured": "cure", "claim": "claim", "converted": "conversion", "clicked": "click",
         "mastitis": "mastitis", "outbreak": "outbreak", "fraud": "fraud"}
DROP = ("next", "year", "month", "week", "day", "days", "h", "pct", "is", "has", "was", "will")


def stem(target):
    """churned -> churn, fails_next_7d -> failure, readmitted_30d -> readmission (else the name minus windows)."""
    parts = [p for p in (target or "").lower().split("_") if p and p not in DROP and not (p[0].isdigit())]
    key = "_".join(parts) or (target or "y").lower()
    if key in STEMS:
        return STEMS[key]
    if key.endswith("ed") and len(key) > 5:
        return key[:-2]
    return key


def _rng(seed):
    """A small Lehmer LCG (Park-Miller): the same seed gives the same draws in every browser."""
    box = [seed % 2147483647 or 1]

    def draw(n):
        box[0] = (box[0] * 48271) % 2147483647
        return box[0] % n if n > 0 else 0
    return draw


def day_number(day_iso):
    y, mo, d = [int(p) for p in day_iso.split("-")]
    return datetime.date(y, mo, d).toordinal()


def _fill(text, target):
    return text.replace("{y}", target).replace("{stem}", stem(target))


def puzzle(day_iso, cases):
    """{date, rounds: [{case, chips: [{name, role, known, leak}], leak: {name, kind, kind_name, why, href, link}}]}"""
    draw = _rng(day_number(day_iso) * 7919 + 13)
    pool = [c for c in cases if c.get("target") and len(c.get("cols") or []) >= 3]
    picked, ids, shapes, inds = [], [], [], []
    for attempt in range(80):
        if len(picked) == ROUNDS or not pool:
            break
        c = pool[draw(len(pool))]
        if c["id"] in ids:
            continue
        if attempt < 60 and (c["shape"] in shapes or c["ind"] in inds):  # vary the rounds while that's easy
            continue
        picked.append(c)
        ids.append(c["id"])
        shapes.append(c["shape"])
        inds.append(c["ind"])
    used = []
    rounds = []
    for c in picked:
        taken = set([n.lower() for n in (c.get("all") or [])] + [c["target"].lower()])
        options = [i for i, b in enumerate(BANK) if c["shape"] in b["shapes"]]
        leak, idx = None, None
        for attempt in range(40):
            if not options:
                break
            i = options[draw(len(options))]
            name = _fill(BANK[i]["col"], c["target"])
            if (i in used and attempt < 30) or name.lower() in taken:
                continue
            leak, idx = BANK[i], i
            break
        if leak is None:  # every option collides: take the first one that doesn't
            for i in options:
                if _fill(BANK[i]["col"], c["target"]).lower() not in taken:
                    leak, idx = BANK[i], i
                    break
        if leak is None:
            continue
        used.append(idx)
        real = list(c["cols"])
        for i in range(len(real) - 1, 0, -1):  # Fisher-Yates with the day's draws
            j = draw(i + 1)
            real[i], real[j] = real[j], real[i]
        chips = [{"name": x["name"], "role": x.get("role") or "feature", "known": bool(x.get("known")), "leak": False}
                 for x in real[:CHIPS - 1]]
        name = _fill(leak["col"], c["target"])
        chips.insert(draw(len(chips) + 1), {"name": name, "role": "feature", "known": bool(leak["known"]), "leak": True})
        kind = KINDS[leak["kind"]]
        rounds.append({
            "case": {"id": c["id"], "ind": c["ind"], "ind_name": c.get("ind_name") or "", "no": c.get("no") or "",
                     "name": c["name"], "q": c.get("q") or "", "task": c["task"], "target": c["target"],
                     "shape_name": c.get("shape_name") or ""},
            "chips": chips,
            "leak": {"name": name, "kind": leak["kind"], "kind_name": kind[0], "why": _fill(leak["why"], c["target"]),
                     "href": kind[1], "link": kind[2]},
        })
    return {"date": day_iso, "rounds": rounds}


def _iso(d):
    return "%04d-%02d-%02d" % (d.year, d.month, d.day)


def shift(day_iso, days):
    return _iso(datetime.date.fromordinal(day_number(day_iso) + days))


def blank():
    return {"days": {}, "streak": 0, "best": 0, "last": ""}


def record(st, day_iso, today_iso, score):
    """Save a finished puzzle. Only today's puzzle moves the streak: up after yesterday's, back to 1 after a gap."""
    st = dict(st or blank())
    days = dict(st.get("days") or {})
    first = day_iso not in days
    days[day_iso] = score
    if len(days) > 120:  # keep the browser's record small
        for k in sorted(days.keys())[:len(days) - 120]:
            del days[k]
    st["days"] = days
    if day_iso == today_iso and first:
        last = st.get("last") or ""
        if last == shift(today_iso, -1):
            st["streak"] = int(st.get("streak") or 0) + 1
        elif last != today_iso:
            st["streak"] = 1
        st["last"] = today_iso
        st["best"] = max(int(st.get("best") or 0), st["streak"])
    return st


def streak_now(st, today_iso):
    st = st or {}
    last = st.get("last") or ""
    if last and last in (today_iso, shift(today_iso, -1)):
        return int(st.get("streak") or 0)
    return 0


def share_line(day_iso, score, n=ROUNDS):
    return "RoboIntern Leak Hunt %s: %d/%d · %s/#leakhunt/%s" % (day_iso, score, n, SITE, day_iso)


def parse_record(text):
    """The browser's record (store key "leakhunt", JSON text) as a dict; a fresh one if missing or broken."""
    try:
        st = json.loads(text) if text else None
    except Exception:
        st = None
    return st if isinstance(st, dict) and isinstance(st.get("days"), dict) else blank()
