from anvil import *

from ._anvil_designer import NoteItemTemplate
from ... import ri, router, state


class NoteItem(NoteItemTemplate):
    """One of my listings in the notebook. item = a snippet_meta dict (+ "no"). The star raises x-star to the page."""

    def __init__(self, **properties):
        super().__init__(**properties)
        s = self.item
        self.no.text = "Listing %s" % s.get("no", "")
        meta = [{"text": ri.model_name(s["model"]), "kind": "meta"}, {"text": ri.task_name(s["task"]), "kind": "meta"}]
        if s.get("target"):
            meta.append({"text": "y = " + s["target"], "kind": "meta"})
        if s.get("is_public"):
            meta.append({"text": "public" + (" · cited %d×" % s["cites"] if s.get("cites") else ""), "kind": "good"})
        if s.get("forked"):
            meta.append({"text": "fork", "kind": "badge"})
        self.meta_panel.items = meta
        self.notes.visible = bool(s.get("notes"))
        self.tag_panel.items = [{"text": "#" + t, "kind": "meta"} for t in s.get("tags") or []] + [
            {"text": "edited " + state.ago(s.get("updated")), "kind": "meta"}]
        state.set_attr(self.title_link, "href", router.href("snippet", s["id"]))
        self.star_button.role = ["nb-star", "on"] if s.get("starred") else ["nb-star"]
        state.set_control_attr(self.star_button, "aria-label", "Unstar" if s.get("starred") else "Star")
        state.set_control_attr(self.star_button, "aria-pressed", "true" if s.get("starred") else "false")
        state.set_control_attr(self.star_button, "data-key", "star-" + s["id"])

    @handle("star_button", "click")
    def star_button_click(self, **event_args):
        self.parent.raise_event("x-star", snippet=self.item)
