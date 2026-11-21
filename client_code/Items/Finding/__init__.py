from anvil import *

from ._anvil_designer import FindingTemplate
from ... import state

LEVELS = {"bad": "problem", "warn": "careful", "good": "good", "info": "note"}


class Finding(FindingTemplate):
    """One finding of Read my results (Pages/Results). item = {level, title, text, href, link} from readout.read():
    a level tag, a plain-words title and explanation, and a link to the Atlas page (or the Lab's leak check)."""

    def __init__(self, **properties):
        super().__init__(**properties)
        level = self.item.get("level") or "info"
        state.set_attr(self.card, "class", "rs-finding lv-" + level)
        self.lv.text = LEVELS.get(level, "note")
        self.link.visible = bool(self.item.get("href"))
        if self.item.get("href"):
            state.set_attr(self.link, "href", self.item["href"])
            self.link_text.text = self.item.get("link") or "Read more"
