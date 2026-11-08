from anvil import *

from ._anvil_designer import DatasetRowTemplate
from ... import ri


class DatasetRow(DatasetRowTemplate):
    """A saved data description in the notebook's side card. item = dataset_dict (Notebook.py). Raises x-open-ds and
    x-delete-ds to the page."""

    def __init__(self, **properties):
        super().__init__(**properties)
        d = self.item
        bits = ["%d columns" % d["ncols"]]
        if d.get("target"):
            bits.append("y = " + d["target"])
        task = (d.get("spec") or {}).get("task")
        if task:
            bits.append(ri.task_name(task))
        self.line.text = " · ".join(bits)

    @handle("open_button", "click")
    def open_button_click(self, **event_args):
        self.parent.raise_event("x-open-ds", dataset=self.item)

    @handle("delete_button", "click")
    def delete_button_click(self, **event_args):
        self.parent.raise_event("x-delete-ds", dataset=self.item)
