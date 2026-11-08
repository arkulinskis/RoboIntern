from anvil import *

from ._anvil_designer import CommonsCardTemplate
from ... import ri, router, state


class CommonsCard(CommonsCardTemplate):
    """A shared listing in the Commons. item = snippet_meta (Commons.list_commons)."""

    def __init__(self, **properties):
        super().__init__(**properties)
        s = self.item
        state.set_attr(self, "href", router.href("snippet", s["id"]))
        meta = [{"text": ri.model_name(s["model"]), "kind": "meta"}, {"text": ri.task_name(s["task"]), "kind": "meta"}]
        if s.get("target"):
            meta.append({"text": "y = " + s["target"], "kind": "meta"})
        self.meta_panel.items = meta
        self.notes.visible = bool(s.get("notes"))
        self.tag_panel.items = [{"text": "#" + t, "kind": "meta"} for t in s.get("tags") or []]
        self.who.text = "%s · %s" % (s.get("author") or "", state.ago(s.get("updated")))
        self.cite.text = "cited %d×" % s["cites"] if s.get("cites") else "%d cols" % s.get("ncols", 0)
