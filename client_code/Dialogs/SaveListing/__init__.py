import anvil.server
from anvil import *

from ._anvil_designer import SaveListingTemplate
from ... import state


def tag_list(text):
    return [t.strip() for t in (text or "").split(",") if t.strip()]


class SaveListing(SaveListingTemplate):
    """The Lab's "Save to notebook" dialog. data = {title, model, spec, files} from the Lab (ri.save_listing).
    Closes with the new listing's id, or None."""

    def __init__(self, data=None, **properties):
        self.data = data or {}
        super().__init__(**properties)
        self.title_box.text = self.data.get("title") or ""
        state.set_control_attr(self.title_box, "maxlength", "120")
        state.set_control_attr(self.notes_box, "maxlength", "4000")
        state.set_control_attr(self.tags_box, "maxlength", "200")

    @handle("", "show")
    def form_show(self, **event_args):
        self.title_box.focus()

    @handle("title_box", "pressed_enter")
    def title_box_pressed_enter(self, **event_args):
        self.save_button_click()

    @handle("cancel_button", "click")
    def cancel_button_click(self, **event_args):
        self.raise_event("x-close-alert", value=None)

    @handle("save_button", "click")
    def save_button_click(self, **event_args):
        title = (self.title_box.text or "").strip()
        if not title:
            self.message.text, self.message.visible = "Give the listing a title.", True
            return
        d = self.data
        payload = {"title": title, "model": d.get("model"), "spec": d.get("spec"), "files": d.get("files"),
                   "notes": self.notes_box.text or "", "tags": tag_list(self.tags_box.text),
                   "is_public": bool(self.public_box.checked)}
        self.save_button.enabled = False
        try:
            r = anvil.server.call("save_snippet", None, payload)
        finally:
            self.save_button.enabled = True
        if not r.get("ok"):
            self.message.text, self.message.visible = r.get("error") or "That didn't work.", True
            return
        state.toast("Saved to your notebook", "ok")
        self.raise_event("x-close-alert", value=r["snippet"]["id"])
