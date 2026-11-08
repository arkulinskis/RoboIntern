import json

from anvil import *
import anvil.js
from anvil.js import window

from ._anvil_designer import CodeBlockTemplate


class CodeBlock(CodeBlockTemplate):
    """The highlighted code of a listing with its file tabs and buttons (the engine draws it; tabs switch in the
    browser). show(files, active, meta, can_edit): files = {train, predict, requirements}, meta = {title, model, spec,
    notes} for the notebook export. Raises edit_code(file=...) when the owner presses Edit."""

    def __init__(self, **properties):
        super().__init__(**properties)
        self._on_edit = anvil.js.report_exceptions(self._edit)

    def show(self, files, active="train", meta=None, can_edit=False):
        window.RI.py.codeBlock(self.dom_nodes["host"], json.dumps(files or {}), active or "train",
                               json.dumps(meta or {}), bool(can_edit), self._on_edit)

    def active(self):
        return getattr(self.dom_nodes["host"], "__riCur", None) or "train"

    def _edit(self, file):
        self.raise_event("edit_code", file=file)
