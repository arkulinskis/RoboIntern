from anvil import *
from anvil.js import window

from ._anvil_designer import SampleCardTemplate
from ... import router


class SampleCard(SampleCardTemplate):
    """A Lab sample as a quick start on an empty notebook. item = {key, name, line} (ri.meta()["samples"]).
    The click puts the sample in the Lab's hand-off store (RI.py.startSample) and opens the Lab."""

    def __init__(self, **properties):
        super().__init__(**properties)

    def sample_click(self, event):
        window.RI.py.startSample(self.item["key"])
        router.go("lab")
