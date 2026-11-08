from anvil import *
from anvil.js import window

from ._anvil_designer import CommonsTemplate
from ... import ri, state

TASKS = ["forecast", "regression", "binary", "multiclass", "anomaly", "cluster"]


class Commons(CommonsTemplate):
    """#commons: listings people chose to share. Open to everyone. Search (debounced), filter by task and model, sort by
    newest or most cited. Server: list_commons. Forking happens on the listing page."""

    def __init__(self, args=(), **properties):
        super().__init__(**properties)
        self.task, self.model, self.sort = "", "", "new"
        self._first = True
        self._timer = None
        self.task_buttons = dict(zip(TASKS, [self.t_forecast, self.t_regression, self.t_binary, self.t_multiclass,
                                             self.t_anomaly, self.t_cluster]))
        short = ri.meta()["task_short"]
        for t, b in self.task_buttons.items():
            b.text = short.get(t, t)
            b.add_event_handler("click", self._task_handler(t, b))
        self.t_all.add_event_handler("click", self._task_handler("", self.t_all))
        state.set_control_attr(self.search_box, "aria-label", "Search the Commons")
        self.load()

    def load(self):
        d = state.call_quiet("list_commons", (self.search_box.text or "").strip() or None, self.model or None,
                             self.task or None, self.sort)
        if d is None:
            state.toast("Couldn't load the Commons. Check your connection.", "error")
            return
        if self._first:
            self._first = False
            self.model_box.items = [("All models", "")] + [
                ("%s (%d)" % (ri.model_name(k), n), k) for k, n in sorted(d["models"].items(), key=lambda kv: ri.model_name(kv[0]))]
            state.set_control_attr(self.model_box, "aria-label", "Model")
            for t, b in self.task_buttons.items():
                b.visible = bool(d["tasks"].get(t))
        self.list_panel.items = d["items"]
        self.count.text = state.plural(d["total"], "listing")
        self.count.visible = bool(d["items"])
        self.empty.visible = not d["items"]
        filtered = bool((self.search_box.text or "").strip() or self.model or self.task)
        self.empty_title.text = "Nothing matches" if filtered else "Nothing shared yet"

    def _later(self):
        if self._timer is not None:
            window.clearTimeout(self._timer)
        self._timer = window.setTimeout(self.load, 250)

    @handle("search_box", "change")
    def search_box_change(self, **event_args):
        self._later()

    @handle("model_box", "change")
    def model_box_change(self, **event_args):
        self.model = self.model_box.selected_value or ""
        self.load()

    def _task_handler(self, task, button):
        def click(**event_args):
            self.task = task
            for b in [self.t_all] + list(self.task_buttons.values()):
                b.role = ["seg", "on"] if b is button else ["seg"]
            self.load()
        return click

    def _sort(self, value):
        self.sort = value
        self.s_new.role = ["seg", "on"] if value == "new" else ["seg"]
        self.s_cited.role = ["seg", "on"] if value == "cited" else ["seg"]
        self.load()

    @handle("s_new", "click")
    def s_new_click(self, **event_args):
        self._sort("new")

    @handle("s_cited", "click")
    def s_cited_click(self, **event_args):
        self._sort("cited")

    def leave(self):
        if self._timer is not None:
            window.clearTimeout(self._timer)
