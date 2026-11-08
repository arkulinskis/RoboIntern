import anvil.server
from anvil import *

from ._anvil_designer import EditDetailsTemplate
from ... import state
from ..SaveListing import tag_list


class EditDetails(EditDetailsTemplate):
    """A listing's title, notes and tags (Pages/Snippet). Closes with the saved listing (server reply), or None."""

    def __init__(self, snippet=None, **properties):
        self.snippet = snippet or {}
        super().__init__(**properties)
        s = self.snippet
        self.title_box.text = s.get("title") or ""
        self.notes_box.text = s.get("notes") or ""
        self.tags_box.text = ", ".join(s.get("tags") or [])
        state.set_control_attr(self.title_box, "maxlength", "120")
        state.set_control_attr(self.notes_box, "maxlength", "4000")
        state.set_control_attr(self.tags_box, "maxlength", "200")

    @handle("", "show")
    def form_show(self, **event_args):
        self.title_box.focus()

    @handle("cancel_button", "click")
    def cancel_button_click(self, **event_args):
        self.raise_event("x-close-alert", value=None)

    @handle("save_button", "click")
    def save_button_click(self, **event_args):
        title = (self.title_box.text or "").strip()
        if not title:
            self.message.text, self.message.visible = "Give the listing a title.", True
            return
        self.save_button.enabled = False
        try:
            r = anvil.server.call("save_snippet", self.snippet["id"],
                                  {"title": title, "notes": self.notes_box.text or "", "tags": tag_list(self.tags_box.text)})
        finally:
            self.save_button.enabled = True
        if not r.get("ok"):
            self.message.text, self.message.visible = r.get("error") or "That didn't work.", True
            return
        state.toast("Saved", "ok")
        self.raise_event("x-close-alert", value=r["snippet"])
