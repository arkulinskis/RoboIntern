import anvil.server
from anvil import *

from ._anvil_designer import SaveDatasetTemplate
from ... import state


class SaveDataset(SaveDatasetTemplate):
    """The Lab's "Save description" dialog. data = {spec, name, current: {id, name} or None} (ri.save_dataset).
    With a current description, a tick box chooses between updating it and saving a new one.
    Closes with the saved description's id, or None."""

    def __init__(self, data=None, **properties):
        self.data = data or {}
        super().__init__(**properties)
        self.name_box.text = self.data.get("name") or ""
        state.set_control_attr(self.name_box, "maxlength", "80")
        cur = self.data.get("current")
        self.overwrite_box.visible = bool(cur)
        if cur:
            self.overwrite_box.text = "Update “%s” (untick to save a new one)" % cur["name"]

    @handle("", "show")
    def form_show(self, **event_args):
        self.name_box.focus()

    @handle("name_box", "pressed_enter")
    def name_box_pressed_enter(self, **event_args):
        self.save_button_click()

    @handle("cancel_button", "click")
    def cancel_button_click(self, **event_args):
        self.raise_event("x-close-alert", value=None)

    @handle("save_button", "click")
    def save_button_click(self, **event_args):
        name = (self.name_box.text or "").strip()
        if not name:
            self.message.text, self.message.visible = "Give it a name.", True
            return
        cur = self.data.get("current")
        target = cur["id"] if cur and self.overwrite_box.checked else None
        self.save_button.enabled = False
        try:
            r = anvil.server.call("save_dataset", target, name, self.data.get("spec"))
        finally:
            self.save_button.enabled = True
        if not r.get("ok"):
            self.message.text, self.message.visible = r.get("error") or "That didn't work.", True
            return
        state.toast("Data description saved", "ok")
        self.raise_event("x-close-alert", value=r["dataset"]["id"])
