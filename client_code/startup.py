"""The app starts here (anvil.yaml: startup module). One server call to learn who is signed in (Anvil's loading
spinner shows meanwhile), the Privacy & Terms kit, the engine bridge (ri.py), then the page for the address in the browser bar."""
import anvil.server

from . import legal, ri, router, state

LEGAL_THEME = {"accent": "#1f3a93"}  # colours for the Privacy & Terms page (match --c-brand in app.css)

legal.setup(LEGAL_THEME)
ri.setup()  # the server bridge and the dialogs for the JavaScript screens (Lab, Atlas, Casebook)
state.set_me(anvil.server.call("get_me"))
if state.me():
    legal.refresh_soon()
router.start()
