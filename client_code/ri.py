"""RoboIntern's JavaScript engine (theme/assets/ri-engine.js, window.RI) and its three screens (ri-screens.js: the Lab,
the Atlas, the Casebook) seen from Python.

    ri.setup()            once at start-up: the server bridge for the screens (UI.api) and RI.host (their dialogs)
    ri.meta()             the engine's catalogue as plain Python: counts, tasks, models {slug: {name, summary, tmpl}},
                          industries, Lab samples (cached; parsed once)
    ri.model_name(slug)   a model's display name (the slug itself if the model is gone)
    ri.task_name(task)    "Forecasting", "Regression" ... (RI.TASKS)
    ri.js(name, *args)    call RI.py.<name>(...) and json-decode its reply; ri.eq(slug) = a model's equation (TeX)
Everything crosses as JSON text: Python never holds JS objects (ANVIL_NOTES: CarChoice, Service Request).
"""
import json

import anvil
import anvil.server
from anvil import alert, confirm
from anvil.js import window

from . import router, state

RI = window.RI
UI = window.UI
_cache: dict = {}


def js(name, *args):
    out = getattr(RI.py, name)(*args)
    return json.loads(out) if isinstance(out, str) else out


def eq(slug):
    """A model's defining equation in TeX (for Components/Tex)."""
    return str(RI.py.eq(slug))


def meta():
    if "meta" not in _cache:
        _cache["meta"] = js("meta")
    return _cache["meta"]


def model(slug):
    return meta()["models"].get(slug)


def model_name(slug):
    m = model(slug)
    return m["name"] if m else (slug or "")


def task_name(task):
    return meta()["tasks"].get(task, task or "")


# ---------------------------------------------------------------- server calls for the screens (UI.api)
def _bridge(payload_json):
    """Called from JS. Always returns a JSON string: {"result": ...} or {"error": ...}."""
    p = json.loads(payload_json) if payload_json else {}
    try:
        call = anvil.server.call_s if p.get("quiet") else anvil.server.call
        return json.dumps({"result": call(p["fn"], *(p.get("args") or []))})
    except Exception as e:
        kind_of = type(e).__name__  # (some of Anvil's exception classes aren't in the validator's stubs)
        if kind_of == "SessionExpiredError":
            return json.dumps({"error": "Your session expired. Reload the page and sign in again.", "reload": True})
        if kind_of == "AppOfflineError":
            return json.dumps({"error": "You seem to be offline. Check your connection and try again."})
        if kind_of == "PermissionDenied":
            return json.dumps({"error": str(e) or "You don't have access to that.", "denied": True})
        print("bridge %s failed: %r" % (p.get("fn", ""), e))
        return json.dumps({"error": "Something went wrong. Please try again.", "detail": repr(e)[:300]})


# ---------------------------------------------------------------- RI.host: what the screens ask Python to show
def _toast(message, kind=""):
    state.toast(message, kind or None)


def _confirm(options_json):
    o = json.loads(options_json or "{}")
    return bool(confirm(o.get("text") or "", title=o.get("title") or "Are you sure?",
                        buttons=[(o.get("cancel") or "Cancel", False), (o.get("ok") or "OK", True)], role="app-dialog"))


def _remember_after(target):
    router.remember_after(target)


def _go(target):
    router.show()


def save_listing(data_json):
    """The Lab's "Save to notebook": Dialogs/SaveListing saves it; then offer to open the listing."""
    from .Dialogs.SaveListing import SaveListing
    snippet_id = alert(SaveListing(data=json.loads(data_json)), buttons=[], role="app-dialog", dismissible=True)
    if snippet_id:
        if confirm("Open the listing now, or keep working in the Lab?", title="Saved",
                   buttons=[("Stay here", False), ("Open listing", True)], role="app-dialog"):
            router.go("snippet", snippet_id)
    return snippet_id or None


def save_dataset(data_json):
    """The Lab's "Save description": Dialogs/SaveDataset. Returns the saved dataset's id (or None)."""
    from .Dialogs.SaveDataset import SaveDataset
    return alert(SaveDataset(data=json.loads(data_json)), buttons=[], role="app-dialog", dismissible=True) or None


def setup():
    window.RI_BRIDGE = _bridge
    host = RI.host
    host.toast = _toast
    host.confirm = _confirm
    host.remember_after = _remember_after
    host.go = _go
    host.save_listing = save_listing
    host.save_dataset = save_dataset
