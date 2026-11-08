from anvil import *
from anvil.js import window

from ._anvil_designer import SampleCardTemplate
from ... import router


class SampleCard(SampleCardTemplate):
    """A Lab sample as a quick start on an empty notebook. item = {key, name, line} (ri.meta()["samples"])."""

    def __init__(self, **properties):
        super().__init__(**properties)
        self.button.text = self.item["name"] + "\n" + self.item["line"]

    @handle("button", "click")
    def button_click(self, **event_args):
        window.RI.py.startSample(self.item["key"])
        router.go("lab")
