from anvil import *

from ._anvil_designer import IndustryTileTemplate
from ... import router, state


class IndustryTile(IndustryTileTemplate):
    """One industry on the landing page's Casebook teaser. item = {key, name, icon, n} (ri.meta()["industries"])."""

    def __init__(self, **properties):
        super().__init__(**properties)
        state.set_attr(self, "href", router.href("cases", self.item["key"]))
        self.icon.classes.add("ic-" + self.item["icon"])
        self.count.text = str(self.item["n"])
