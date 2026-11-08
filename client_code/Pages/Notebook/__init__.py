from anvil import *

from ._anvil_designer import NotebookTemplate
from ... import ri, router, state

FILTERS = ["all", "starred", "public"]


class Notebook(NotebookTemplate):
    """#notebook, a member's home: their listings (search, All / Starred / Public, star), the lemma of the day, their
    saved data descriptions (open in the Lab, delete) and, when empty, the Lab samples as quick starts.
    Server: get_notebook, save_snippet (star), delete_dataset. "Listing n" numbers follow creation order."""

    def __init__(self, args=(), **properties):
        super().__init__(**properties)
        self.filter = "all"
        self.data = {"snippets": [], "datasets": [], "stats": {}}
        state.heading(self.title, 1)
        state.set_control_attr(self.search_box, "aria-label", "Search your listings")
        me = state.me() or {}
        first = (me.get("name") or "My").split(" ")[0]
        self.title.text = first + "’s notebook"
        lemma = ri.js("lemma")
        state.set_attr(self.lemma_link, "href", router.href("atlas", "model", lemma["slug"]))
        self.lemma_name.text = lemma["name"]
        self.lemma_eq.tex = lemma["eq"]
        self.dom_nodes["lemma_text"].innerHTML = lemma["intuition"]  # RI.mtext: escaped prose + typeset $...$
        self.sample_panel.items = ri.meta()["samples"]
        self.list_panel.add_event_handler("x-star", self._star)
        self.ds_panel.add_event_handler("x-open-ds", self._open_ds)
        self.ds_panel.add_event_handler("x-delete-ds", self._delete_ds)
        self.load()

    def load(self):
        d = state.call("get_notebook")
        if d is None:
            return
        self.data = d
        st = d["stats"]
        self.stats.tex = (r"|\mathcal L| = %d,\quad |\mathcal D| = %d,\quad |\{m\}| = %d,\quad \textstyle\sum \text{citations} = %d"
                          % (st["snippets"], st["datasets"], st["models"], st["cited"]))
        self.ds_panel.items = d["datasets"]
        self.no_ds.visible = not d["datasets"]
        self.draw()

    def draw(self):
        snips = self.data["snippets"]
        self.list_part.visible = bool(snips)
        self.empty_part.visible = not snips
        q = (self.search_box.text or "").strip().lower()

        def keep(s):
            if self.filter == "starred" and not s["starred"]:
                return False
            if self.filter == "public" and not s["is_public"]:
                return False
            hay = " ".join([s["title"], s["notes"], s["model"], s.get("target") or "", " ".join(s["tags"]),
                            ri.model_name(s["model"])]).lower()
            return not q or q in hay

        items = sorted([s for s in snips if keep(s)], key=lambda s: s["updated"] or "", reverse=True)
        items.sort(key=lambda s: not s["starred"])  # starred first, newest first within each
        self.list_panel.items = items
        self.no_match.visible = bool(snips) and not items
        for name, b in zip(FILTERS, [self.f_all, self.f_starred, self.f_public]):
            b.role = ["seg", "on"] if name == self.filter else ["seg"]

    @handle("search_box", "change")
    def search_box_change(self, **event_args):
        self.draw()

    def _set_filter(self, value):
        self.filter = value
        self.draw()

    @handle("f_all", "click")
    def f_all_click(self, **event_args):
        self._set_filter("all")

    @handle("f_starred", "click")
    def f_starred_click(self, **event_args):
        self._set_filter("starred")

    @handle("f_public", "click")
    def f_public_click(self, **event_args):
        self._set_filter("public")

    def _star(self, snippet, **event_args):
        snippet["starred"] = not snippet["starred"]
        key = "star-" + snippet["id"]
        self.draw()
        state.refocus(self.list_panel, key)
        r = state.call_quiet("save_snippet", snippet["id"], {"starred": snippet["starred"]})
        if not (isinstance(r, dict) and r.get("ok")):
            snippet["starred"] = not snippet["starred"]
            self.draw()
            state.toast((r or {}).get("error") or "That didn't work.", "error")

    def _open_ds(self, dataset, **event_args):
        state.store_set("lab-load", {"spec": dataset["spec"]})
        router.go("lab")

    def _delete_ds(self, dataset, **event_args):
        if confirm("Listings made from it keep their own copy of the columns.", title="Delete “%s”?" % dataset["name"],
                   buttons=[("Cancel", False), ("Delete", True)], role="app-dialog"):
            if state.call("delete_dataset", dataset["id"]) is not None:
                self.load()
