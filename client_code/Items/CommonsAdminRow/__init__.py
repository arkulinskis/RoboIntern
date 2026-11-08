from anvil import *

from ._anvil_designer import CommonsAdminRowTemplate
from ... import ri, router, state


class CommonsAdminRow(CommonsAdminRowTemplate):
    """A public listing in Admin -> Commons (moderation). item = snippet_meta. Unpublish / delete, then x-changed."""

    def __init__(self, **properties):
        super().__init__(**properties)
        s = self.item
        self.model.text = ri.model_name(s["model"])
        self.demo.visible = bool(s.get("demo"))
        self.when.text = "%s · cited %d×" % (state.short_date(s.get("updated")), s.get("cites") or 0)
        self.notes.visible = bool(s.get("notes"))
        state.set_attr(self.title_link, "href", router.href("snippet", s["id"]))

    @handle("unpublish_button", "click")
    def unpublish_button_click(self, **event_args):
        if state.call("admin_unpublish", self.item["id"]) is not None:
            state.toast("Unpublished", "ok")
            self.parent.raise_event("x-changed")

    @handle("delete_button", "click")
    def delete_button_click(self, **event_args):
        if confirm("It is removed from its author's notebook too.", title="Delete this listing?",
                   buttons=[("Cancel", False), ("Delete", True)], role="app-dialog"):
            if state.call("delete_snippet", self.item["id"]) is not None:
                self.parent.raise_event("x-changed")
