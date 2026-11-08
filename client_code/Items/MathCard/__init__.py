from anvil import *

from ._anvil_designer import MathCardTemplate
from ... import router, state


class MathCard(MathCardTemplate):
    """A typeset model on the landing page. item = {slug, name, summary, eq}."""

    def __init__(self, **properties):
        super().__init__(**properties)
        state.set_attr(self, "href", router.href("atlas", "model", self.item["slug"]))
        self.eq.tex = self.item["eq"]
