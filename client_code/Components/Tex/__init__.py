from anvil import *
import anvil.js
from anvil.js import window

from ._anvil_designer import TexTemplate


class Tex(TexTemplate):
    """A typeset formula (RI.tex). Set .tex (and .display); it draws again when KaTeX finishes loading."""

    def __init__(self, **properties):
        self._tex = ""
        self._display = False
        super().__init__(**properties)
        window.RI.whenTex(anvil.js.report_exceptions(self._draw))
        self._draw()

    @property
    def tex(self):
        return self._tex

    @tex.setter
    def tex(self, value):
        self._tex = value or ""
        self._draw()

    @property
    def display(self):
        return self._display

    @display.setter
    def display(self, value):
        self._display = bool(value)
        self._draw()

    def _draw(self, *args):
        box = getattr(self, "dom_nodes", {}).get("box")
        if box is not None:
            box.innerHTML = window.RI.tex(self._tex, self._display) if self._tex else ""
