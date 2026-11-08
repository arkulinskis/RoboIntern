from anvil import *

from ._anvil_designer import AtlasTemplate


class Atlas(AtlasTemplate):
    """#atlas/...: The Atlas: the dictionary of models, features, validation schemes and metrics, entry pages, the model plane.
    A JavaScript screen in Components/Screen (theme/assets/ri-screens.js); its dialogs are Python (ri.py, Dialogs/)."""

    waits = True  # router: the screen sets UI_READY itself once it has loaded

    def __init__(self, args=(), **properties):
        super().__init__(**properties)
        self.screen.mount(list(args))
