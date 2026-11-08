from anvil import *

from ._anvil_designer import TagTemplate


class Tag(TagTemplate):
    """A small chip: item = {text, kind} with kind "code" (a column name), "sig" (an outside signal), "tag" (#tag),
    or "meta" (plain mono text)."""

    def __init__(self, **properties):
        super().__init__(**properties)
        self.text.role = ["ri-chip", "ri-chip-" + (self.item.get("kind") or "meta")]
