"""Page addresses: #name/arg1/arg2 -> a page Form (open_form), with sign-in rules.

Same addresses as the JavaScript version (#lab, #atlas/model/lgbm, #cases/retail/<id>, #snippet/<id> ...), so links
people shared keep working. Links in templates are plain <a href="#lab">; code calls router.go("snippet", id).

    PAGES[name] = (who may open it, browser-tab title)   who: None = anyone, "guest" = signed out only, "user", "admin"
    NAV = the main menu (header + phone tab bar): (page, label, icon, members only).
New page: add it to PAGES, to _form() and (if it belongs in the menu) to NAV.
"""
import anvil
import anvil.js
from anvil.js import window

from . import state

PAGES = {
    "landing": (None, "A field guide to predictive models"),
    "auth": ("guest", "Sign in"),
    "lab": (None, "The Lab"),
    "cases": (None, "The Casebook"),
    "atlas": (None, "The Atlas"),
    "notebook": ("user", "Notebook"),
    "commons": (None, "The Commons"),
    "snippet": (None, "Listing"),
    "profile": ("user", "Your profile"),
    "admin": ("admin", "Admin"),
}
# The main menu, same order as the JavaScript version: (page, label, icon, members only). The header shows it to
# everyone (Notebook only to members); the phone tab bar (members) shows all five + You.
NAV = [("lab", "Lab", "flask", False), ("cases", "Cases", "cases", False), ("atlas", "Atlas", "book", False),
       ("notebook", "Notebook", "notebook", True), ("commons", "Commons", "users", False)]
HOME = "notebook"
APP_NAME = "RoboIntern"
_r: dict = {"after": "", "listening": False, "page": ""}


def _form(name):
    """The page's Form class (imported when first needed, so start-up stays quick)."""
    if name == "landing":
        from .Pages.Landing import Landing
        return Landing
    if name == "auth":
        from .Pages.Auth import Auth
        return Auth
    if name == "lab":
        from .Pages.Lab import Lab
        return Lab
    if name == "cases":
        from .Pages.Cases import Cases
        return Cases
    if name == "atlas":
        from .Pages.Atlas import Atlas
        return Atlas
    if name == "notebook":
        from .Pages.Notebook import Notebook
        return Notebook
    if name == "commons":
        from .Pages.Commons import Commons
        return Commons
    if name == "snippet":
        from .Pages.Snippet import Snippet
        return Snippet
    if name == "profile":
        from .Pages.Profile import Profile
        return Profile
    from .Pages.Admin import Admin
    return Admin


def parse(hash_text):
    h = (hash_text or "").lstrip("#").lstrip("!").lstrip("/").split("?")[0]
    parts = [window.decodeURIComponent(p) for p in h.split("/") if p]
    return (parts[0] if parts else ""), parts[1:]


def href(name, *args):
    """'#name/arg1/arg2' with every part URL-encoded (row ids contain brackets and commas)."""
    return "#" + "/".join([name] + [window.encodeURIComponent(str(a)) for a in args if a not in (None, "")])


def home_page():
    return HOME if state.me() else "landing"


def show():
    """Open the page for the current address."""
    name, args = parse(window.location.hash)
    if name not in PAGES:
        name, args = home_page(), []
    who = PAGES[name][0]
    if who == "guest" and state.me():
        name, args = HOME, []
    elif who in ("user", "admin") and not state.me():
        _r["after"] = window.location.hash
        name, args = "auth", []
    elif who == "admin" and not state.is_admin():
        state.toast("That page is for admins only.", "error")
        name, args = HOME, []
    _r["page"] = name
    window.document.title = PAGES[name][1] + " · " + APP_NAME
    window.UI_READY = False
    old = _r.get("form")
    if old is not None and hasattr(old, "leave"):
        old.leave()  # pages with timers stop them here
    page = _form(name)(args=args)
    _r["form"] = page
    anvil.open_form(page)
    shell = getattr(page, "layout", None)
    if shell is not None and hasattr(shell, "refresh"):
        shell.refresh(name)  # Anvil reuses the layout between pages: tell it who is signed in and which page is open
    window.scrollTo(0, 0)
    if not getattr(page, "waits", False):
        window.UI_READY = True  # tests and screenshots wait for this (screen pages set it when their engine is ready)


def current():
    """The name of the page on screen."""
    return _r["page"]


def go(name, *args):
    """Go to a page. Same address again = reload the page."""
    target = href(name, *args)
    if window.location.hash == target:
        show()
    else:
        window.location.hash = target


def replace(name, *args):
    """Change the address without opening anything (a page that switches its own view)."""
    window.history.replaceState(None, "", href(name, *args))


def after_sign_in():
    """Where to go once someone signs in: the page they were heading for, or home."""
    target = _r["after"]
    _r["after"] = ""
    if target and target != window.location.hash:
        window.location.hash = target
    else:
        go(HOME)


def remember_after(target):
    _r["after"] = target


def _on_hash(event):
    show()


def start():
    if not _r["listening"]:
        window.addEventListener("hashchange", anvil.js.report_exceptions(_on_hash))
        _r["listening"] = True
    show()
