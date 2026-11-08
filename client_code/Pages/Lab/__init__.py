from anvil import *

from ._anvil_designer import LabTemplate


class Lab(LabTemplate):
    """#lab/...: The Lab: describe the data (§1-§2), pick the task and the trade-offs (§3), see the ranking (§4) and the code (§5).
    A JavaScript screen in Components/Screen (theme/assets/ri-screens.js); its dialogs are Python (ri.py, Dialogs/)."""

    waits = True  # router: the screen sets UI_READY itself once it has loaded

    def __init__(self, args=(), **properties):
        super().__init__(**properties)
        self.screen.mount(list(args))
