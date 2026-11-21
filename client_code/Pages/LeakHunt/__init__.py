import json
import re
from datetime import date

import anvil.js
from anvil import *
from anvil.js import window

from ._anvil_designer import LeakHuntTemplate
from ... import leakhunt, ri, router, state

WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
VERDICTS = {
    3: "Clean sweep. You read columns like a reviewer.",
    2: "Sharp. One slipped through, which is exactly how leaks reach production.",
    1: "One found. Leaks hide behind ordinary names: read why each one leaks.",
    0: "None this time. Every leak has a pattern; tomorrow's will look familiar.",
}


def _cases():
    if "hunt" not in ri._cache:
        ri._cache["hunt"] = ri.js("huntCases") or []
    return ri._cache["hunt"]


def _esc(text):
    return str(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


class LeakHunt(LeakHuntTemplate):
    """#leakhunt[/<YYYY-MM-DD>]: the daily Leak Hunt. Three Casebook cases (client_code/leakhunt.py builds the same puzzle
    for a date in every browser), six column chips each (Items/HuntChip), one planted leak. Tap a chip: the reveal says
    why it leaks, its kind, an Atlas link and the case. Score, streak and the share line at the end. Scores and the
    streak live in this browser only (store key "leakhunt"): no server, no table. Past days play at their own address
    and don't move the streak."""

    def __init__(self, args=(), **properties):
        super().__init__(**properties)
        self.today = leakhunt._iso(date.today())
        self.day = self.today
        if args:
            asked = args[0]
            if self._valid(asked) and asked <= self.today:
                self.day = asked
            else:
                state.toast("That puzzle isn't out yet. Here is today's.")
        self.rec = leakhunt.parse_record(self._stored())
        self.p = leakhunt.puzzle(self.day, _cases())
        self.rounds = self.p["rounds"]
        self.picks = [None] * len(self.rounds)
        self.chips = []
        self.i = 0
        self.score = 0
        self.practice = False
        self.chip_panel.add_event_handler("x-pick", self._pick)
        state.live(self.reveal_title)
        self._draw_nav()
        self.empty_part.visible = not self.rounds
        if not self.rounds:
            self.play_part.visible = self.done_part.visible = False
        elif self.day in self.rec["days"]:
            self.score = int(self.rec["days"][self.day] or 0)
            self._done(earlier=True)
        else:
            self._draw_round()

    # ---- the browser's record
    def _stored(self):
        v = state.store_get("leakhunt", "")
        return v if isinstance(v, str) else ""

    def _save(self):
        state.store_set("leakhunt", json.dumps(self.rec))

    @staticmethod
    def _valid(text):
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", text or ""):
            return False
        try:
            y, m, d = [int(p) for p in text.split("-")]
            date(y, m, d)
            return True
        except Exception:
            return False

    # ---- drawing
    def _draw_nav(self):
        y, m, d = [int(p) for p in self.day.split("-")]
        dt = date(y, m, d)
        self.date_label.text = "%s %d %s %d" % (WEEKDAYS[dt.weekday()], d, state.MONTHS_LONG[m - 1], y)
        self.next_button.enabled = self.day < self.today
        self.today_link.visible = self.day != self.today
        now = leakhunt.streak_now(self.rec, self.today)
        best = int(self.rec.get("best") or 0)
        if now:
            self.streak_label.text = "Streak %s · best %d" % (state.plural(now, "day"), max(best, now))
        elif best:
            self.streak_label.text = "Best streak %s · today's puzzle starts a new one" % state.plural(best, "day")
        else:
            self.streak_label.text = "Play today's puzzle to start a streak"

    def _draw_round(self):
        self.play_part.visible = True
        self.done_part.visible = False
        r = self.rounds[self.i]
        c = r["case"]
        self.round_label.text = "Round %d of %d" % (self.i + 1, len(self.rounds))
        self.case_meta.text = " · ".join([x for x in (c.get("no"), c.get("ind_name"), c.get("shape_name")) if x])
        self.case_name.text = c["name"]
        self.case_q.text = c.get("q") or ""
        self.target_text.text = "%s, the target (%s)" % (c["target"], ri.task_name(c["task"]).lower())
        self.prompt.text = ("Which column leaks? Ticks mark drivers said to be known ahead." if c["task"] == "forecast"
                            else "Which column leaks? Tap it.")
        self.chips = [dict(x, picked=False, state="", done=False) for x in r["chips"]]
        self.chip_panel.items = list(self.chips)
        self.reveal_box.visible = self.picks[self.i] is not None
        if self.picks[self.i] is not None:
            self._reveal(self.picks[self.i], focus=False)

    def _pick(self, chip, **event_args):
        if self.picks[self.i] is not None:
            return
        self.picks[self.i] = chip["name"]
        self._reveal(chip["name"], focus=True)

    def _reveal(self, picked, focus):
        r = self.rounds[self.i]
        leak = r["leak"]
        right = picked == leak["name"]
        for x in self.chips:
            x["done"] = True
            x["picked"] = x["name"] == picked
            x["state"] = ("right" if x["leak"] else "wrong") if x["picked"] else ("leak" if x["leak"] else "")
        self.chip_panel.items = list(self.chips)
        self.reveal_box.visible = True
        state.set_attr(self.reveal_box, "class", "ri-thm lh-reveal " + ("green" if right else "red"))
        self.reveal_title.text = ("Right: %s leaks." % leak["name"] if right else
                                  "Not quite. %s is a real column of this case; the leak was %s." % (picked, leak["name"]))
        self.reveal_kind.text = leak["kind_name"]
        self.reveal_why.text = leak["why"]
        state.set_attr(self.atlas_link, "href", leak["href"])
        self.atlas_text.text = leak["link"]
        c = r["case"]
        state.set_attr(self.case_link, "href", router.href("cases", c["ind"], c["id"]))
        last = self.i == len(self.rounds) - 1
        self.next_round_button.text = "See your score" if last else "Next round"
        self.next_round_button.role = ["btn", "btn-primary", "ic-check" if last else "ic-arrow"]
        if focus:
            anvil.js.get_dom_node(self.reveal_box).focus({"preventScroll": True})
            anvil.js.get_dom_node(self.reveal_box).scrollIntoView({"behavior": "smooth", "block": "nearest"})

    @handle("next_round_button", "click")
    def next_round_button_click(self, **event_args):
        if self.i < len(self.rounds) - 1:
            self.i += 1
            self._draw_round()
            window.scrollTo({"top": 0, "behavior": "smooth"})
            return
        self.score = len([1 for k, r in enumerate(self.rounds) if self.picks[k] == r["leak"]["name"]])
        if not self.practice and self.day not in self.rec["days"]:
            self.rec = leakhunt.record(self.rec, self.day, self.today, self.score)
            self._save()
            self._draw_nav()
        self._done(earlier=False)

    def _done(self, earlier):
        self.play_part.visible = False
        self.done_part.visible = True
        self.round_label.text = "Finished"
        n = len(self.rounds)
        self.score_label.text = "%d/%d" % (self.score, n)
        self.score_text.text = VERDICTS.get(self.score, VERDICTS[0]) if n == 3 else "%d of %d found." % (self.score, n)
        if self.practice:
            self.done_streak.text = "Practice round: your first score for this day stays."
        elif self.day == self.today:
            now = leakhunt.streak_now(self.rec, self.today)
            self.done_streak.text = ("Streak: %s. Come back tomorrow for a new puzzle." % state.plural(now, "day")
                                     if now else "Come back tomorrow for a new puzzle.")
        else:
            self.done_streak.text = "A past puzzle: it counts for its day, not for your streak."
        if earlier and not self.practice:
            self.done_streak.text = "You played this one already. " + self.done_streak.text
        self.dom_nodes["share_preview"].textContent = leakhunt.share_line(self.day, self.score, n)
        lines = []
        for k, r in enumerate(self.rounds):
            c, leak = r["case"], r["leak"]
            mark = ""
            if self.picks[k] is not None:
                mark = " <span class=\"lh-ok\">found</span>" if self.picks[k] == leak["name"] else " <span class=\"lh-miss\">missed</span>"
            lines.append("<li><span class=\"lh-recap-case\">%s %s</span><code>%s</code> %s%s</li>" % (
                _esc(c.get("no") or ""), _esc(c["name"]), _esc(leak["name"]), _esc(leak["kind_name"].lower()), mark))
        self.dom_nodes["recap"].innerHTML = "".join(lines)
        before = leakhunt.shift(self.day, -1)
        state.set_attr(self.yesterday_link, "href", router.href("leakhunt", before))

    # ---- actions
    @handle("share_button", "click")
    def share_button_click(self, **event_args):
        line = leakhunt.share_line(self.day, self.score, len(self.rounds))
        nav = window.navigator
        phone = bool(window.matchMedia("(pointer: coarse)").matches)
        if phone and getattr(nav, "share", None):
            try:
                nav.share({"text": line})
            except Exception:
                pass  # closed the share sheet
            return
        window.RI.copy(line)

    @handle("replay_button", "click")
    def replay_button_click(self, **event_args):
        self.practice = True
        self.picks = [None] * len(self.rounds)
        self.i = 0
        self._draw_round()
        window.scrollTo({"top": 0, "behavior": "smooth"})

    @handle("prev_button", "click")
    def prev_button_click(self, **event_args):
        router.go("leakhunt", leakhunt.shift(self.day, -1))

    @handle("next_button", "click")
    def next_button_click(self, **event_args):
        after = leakhunt.shift(self.day, 1)
        if after >= self.today:
            router.go("leakhunt")
        else:
            router.go("leakhunt", after)
