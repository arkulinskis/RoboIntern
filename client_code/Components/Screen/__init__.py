import json

from anvil import *
import anvil.js
from anvil.js import window

from ._anvil_designer import ScreenTemplate

NULL = anvil.js.call(window.Function("return null"))  # "no screen yet", typed for the validator


class Screen(ScreenTemplate):
    """A JavaScript screen (ri-screens.js) in a page: UI.mountScreen(name, element, args) on show, destroy() on hide.
    The screen draws its own markup, keeps its draft in browser storage and opens Python dialogs through RI.host."""

    def __init__(self, **properties):
        self.screen = ""
        self._args = []
        self.ctl = NULL
        super().__init__(**properties)

    def mount(self, args):
        self._args = [str(a) for a in (args or [])]

    @handle("", "show")
    def form_show(self, **event_args):
        self.destroy()
        self.ctl = window.UI.mountScreen(self.screen, self.dom_nodes["host"], window.JSON.parse(json.dumps(self._args)))

    @handle("", "hide")
    def form_hide(self, **event_args):
        self.destroy()

    def destroy(self):
        if self.ctl is not None:
            self.ctl.destroy()
            self.ctl = NULL

