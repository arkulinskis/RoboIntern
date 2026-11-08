from anvil import *

from ._anvil_designer import SpecColTemplate


class SpecCol(SpecColTemplate):
    """A column of a listing's data description: role glyph (y, t, g, x1, ∅), name (★ = key driver), type.
    item = one of RI.py.specView(...)["columns"]."""

    def __init__(self, **properties):
        super().__init__(**properties)
        c = self.item
        self.glyph_box.classes.add(c["role"])
        self.glyph.text = c["glyph"] + c.get("sub", "")
        self.name.text = c["name"] + (" ★" if c.get("key") else "")
        if c.get("key"):
            self.name.role = ["sn-col-name", "ri-hl-label"]
