from anvil import *

from ._anvil_designer import HuntChipTemplate
from ... import state

ROLE_SAY = {"time": ", the time column t", "group": ", a group id g"}
STATE_SAY = {"right": ": the leak, you found it", "wrong": ": a real column, not the leak", "leak": ": this was the leak"}


class HuntChip(HuntChipTemplate):
    """One column of a Leak Hunt round (Pages/LeakHunt). item = {name, role, known, leak, picked, state, done};
    state "right" | "wrong" | "leak" after the reveal. A real button (keyboard, aria-pressed); the tap raises x-pick."""

    def __init__(self, **properties):
        super().__init__(**properties)
        it = self.item
        self.chip.text = it["name"]
        roles = ["hunt-chip"]
        if it.get("role") == "time":
            roles.append("hunt-t")
        elif it.get("role") == "group":
            roles.append("hunt-g")
        if it.get("known"):
            roles.append("hunt-known")
        if it.get("state"):
            roles.append("hunt-" + it["state"])
        if it.get("done"):
            roles.append("hunt-done")
        self.chip.role = roles
        say = it["name"] + ROLE_SAY.get(it.get("role") or "", "") + (", ticked known ahead" if it.get("known") else "")
        state.set_control_attr(self.chip, "aria-label", say + STATE_SAY.get(it.get("state") or "", ""))
        state.set_control_attr(self.chip, "aria-pressed", "true" if it.get("picked") else "false")
        state.set_control_attr(self.chip, "aria-disabled", "true" if it.get("done") else None)
        state.set_control_attr(self.chip, "data-key", "chip-" + it["name"])

    @handle("chip", "click")
    def chip_click(self, **event_args):
        if not self.item.get("done"):
            self.parent.raise_event("x-pick", chip=self.item)
