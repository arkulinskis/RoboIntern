import json
from datetime import date

import anvil.js
from anvil import *
from anvil.js import window

from ._anvil_designer import ResultsTemplate
from ... import readout, ri, router, state

EXAMPLE_FOR = {"regression": "regression", "binary": "binary", "multiclass": "binary", "forecast": "forecast"}


class Results(ResultsTemplate):
    """#results: Read my results. Paste what a listing's train.py printed; client_code/readout.py (pure Python, in the
    browser, nothing sent) turns it into a verdict and findings with Atlas links. Context (which listing) comes from
    the store key "results-ctx" = {task, model, target, snippet_id, title, can_edit}, set by the Lab's §5 link
    (ri-screens.js) or a listing page. "Add to notes" (own listings only) appends a summary line via save_snippet."""

    def __init__(self, args=(), **properties):
        super().__init__(**properties)
        self.ctx = self._load_ctx()
        self.m = None
        self.head = None
        self._ex = 0
        state.set_control_attr(self.paste_box, "aria-label", "What train.py printed")
        state.set_control_attr(self.paste_box, "spellcheck", "false")
        state.set_control_attr(self.paste_box, "autocomplete", "off")
        state.live(self.verdict_title)
        self.result_part.visible = False
        self.empty_part.visible = True
        self._draw_ctx()

    # ---- the listing this reading is about
    def _load_ctx(self):
        v = state.store_get("results-ctx", None)
        if v is None:
            return {}
        try:
            d = json.loads(str(window.JSON.stringify(v)))
        except Exception:
            return {}
        return d if isinstance(d, dict) else {}

    def _draw_ctx(self):
        c = self.ctx
        title = c.get("title") or (ri.model_name(c["model"]) if c.get("model") else "")
        self.ctx_box.visible = bool(title)
        if title:
            bits = [title]
            if c.get("task"):
                bits.append(ri.task_name(c["task"]))
            self.ctx_text.text = " · ".join(bits)
            if c.get("snippet_id"):
                state.set_attr(self.ctx_link, "href", router.href("snippet", c["snippet_id"]))
                self.ctx_link_text.text = "Back to the listing"
            else:
                state.set_attr(self.ctx_link, "href", "#lab")
                self.ctx_link_text.text = "Back to the Lab"
        self.notes_part.visible = False

    def _can_note(self):
        return bool(self.ctx.get("snippet_id") and self.ctx.get("can_edit") and state.me())

    @handle("ctx_clear", "click")
    def ctx_clear_click(self, **event_args):
        state.store_set("results-ctx", None)
        self.ctx = {}
        self._draw_ctx()
        if self.m is not None:
            self._read()

    # ---- reading
    def _read(self):
        text = self.paste_box.text or ""
        m = readout.parse(text)
        items = readout.read(m, self.ctx) if m.get("found") else []
        head = readout.headline(m, items, self.ctx)
        self.m, self.head = m, head
        self.verdict_title.text = head["title"]
        self.verdict_text.text = head["text"]
        state.set_attr(self.verdict_box, "class", "ri-thm rs-verdict lv-" + head["level"])
        self.finding_panel.items = items
        self.result_part.visible = True
        self.empty_part.visible = False
        self.notes_part.visible = bool(items) and self._can_note()
        self.notes_button.text = "Add to notes"
        self.notes_button.enabled = True
        box = anvil.js.get_dom_node(self.verdict_box)
        box.scrollIntoView({"behavior": "smooth", "block": "nearest"})

    @handle("read_button", "click")
    def read_button_click(self, **event_args):
        self._read()

    @handle("example_button", "click")
    def example_button_click(self, **event_args):
        order = list(readout.EXAMPLE_ORDER)
        first = EXAMPLE_FOR.get(self.ctx.get("task") or "")
        if first in order:  # start with an example of the listing's own task
            order.remove(first)
            order.insert(0, first)
        key = order[self._ex % len(order)]
        self._ex += 1
        self.paste_box.text = readout.EXAMPLES[key]
        self._read()

    @handle("notes_button", "click")
    def notes_button_click(self, **event_args):
        sid = self.ctx.get("snippet_id")
        if not (sid and self.m and self.head and state.me()):
            return
        r = state.call("get_snippet", sid)
        if r is None:
            return
        snip = r["snippet"]
        if not snip.get("can_edit"):
            state.toast("Only the listing's author can add notes to it.", "error")
            return
        line = readout.summary(self.m, self.head, date.today().isoformat())
        old = (snip.get("notes") or "").rstrip()
        notes = (old + "\n\n" + line) if old else line
        if len(notes) > 4000:
            state.toast("The listing's notes are full (4,000 characters). Shorten them on the listing first.", "error")
            return
        self.notes_button.enabled = False
        saved = state.call("save_snippet", sid, {"notes": notes})
        if saved is None:
            self.notes_button.enabled = True
            return
        self.notes_button.text = "Added to notes"
        state.toast("Added to the listing's notes", "ok")
