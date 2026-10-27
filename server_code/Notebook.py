"""Each member's notebook: saved listings (snippets: generated Python + the spec it came from) and saved
data descriptions (datasets: column names, types, roles and task settings).

Only the owner sees and changes their rows. A listing the owner publishes (is_public) can be read and
forked by anyone through Commons.py and get_snippet.
"""
import anvil.server
from anvil.tables import app_tables
import anvil.tables as tables

from . import common as C
from . import DemoData
from . import Specs

MAX_SNIPPETS = 500
MAX_DATASETS = 200


def snippet_meta(r, me):
    spec = r["spec"] or {}
    owner = r["owner"]
    return {"id": r.get_id(), "title": r["title"], "model": r["model"], "task": r["task"],
            "created": C.iso(r["created"]), "updated": C.iso(r["updated"]),
            "starred": bool(r["starred"]), "is_public": bool(r["is_public"]), "cites": int(r["cites"] or 0),
            "tags": list(r["tags"] or []), "notes": (r["notes"] or "")[:240],
            "author": C.name_of(owner), "mine": me is not None and owner == me, "demo": bool(r["is_demo"]),
            "ncols": len(spec.get("columns") or []), "target": Specs.target_of(spec),
            "forked": r["forked_from"] is not None}


def snippet_full(r, me):
    d = snippet_meta(r, me)
    d.update(spec=r["spec"], files=r["files"], notes=r["notes"] or "",
             can_edit=me is not None and r["owner"] == me,
             can_delete=me is not None and (r["owner"] == me or C.is_admin(me)))
    src = r["forked_from"]
    if src is not None and (src["is_public"] or (me is not None and src["owner"] == me)):
        d["forked_from"] = {"id": src.get_id(), "title": src["title"], "author": C.name_of(src["owner"])}
    return d


def dataset_dict(r):
    spec = dict(r["settings"] or {})
    spec["columns"] = r["columns"] or []
    return {"id": r.get_id(), "name": r["name"], "spec": spec, "created": C.iso(r["created"]), "updated": C.iso(r["updated"]),
            "ncols": len(r["columns"] or []), "target": Specs.target_of(spec)}


def _own(table, row_id, me):
    r = C.row_by_id(table, row_id)
    if r is None or r["owner"] != me:
        return None
    return r


# ------------------------------------------------------------------------------------------- the notebook page
@anvil.server.callable(require_user=True)
def get_notebook():
    me = C.require_user()
    DemoData.ensure_loaded()
    snips = app_tables.snippets.search(tables.order_by("updated", ascending=False), owner=me)
    sets = app_tables.datasets.search(tables.order_by("updated", ascending=False), owner=me)
    out = [snippet_meta(r, me) for r in snips]
    # "Listing n" numbers follow creation order, like a paper's listings.
    order = sorted(out, key=lambda s: s["created"] or "")
    for i, s in enumerate(order):
        s["no"] = i + 1
    return {"snippets": out, "datasets": [dataset_dict(r) for r in sets],
            "stats": {"snippets": len(out), "public": sum(1 for s in out if s["is_public"]),
                      "cited": sum(s["cites"] for s in out), "datasets": len(sets),
                      "models": len(set(s["model"] for s in out))}}


# ------------------------------------------------------------------------------------------- data descriptions
@anvil.server.callable(require_user=True)
def list_datasets():
    me = C.require_user()
    rows = app_tables.datasets.search(tables.order_by("updated", ascending=False), owner=me)
    return {"datasets": [dataset_dict(r) for r in rows]}


@anvil.server.callable(require_user=True)
def save_dataset(dataset_id, name, spec):
    me = C.require_user()
    name = C.text(name, 80)
    if len(name) < 2:
        return C.fail("Give the data description a name (at least 2 characters).")
    spec = Specs.clean_spec(spec)
    if not spec or not spec["columns"]:
        return C.fail("There are no columns to save yet. Paste a header row first.")
    settings = {k: v for k, v in spec.items() if k != "columns"}
    if dataset_id:
        r = _own(app_tables.datasets, dataset_id, me)
        if r is None:
            return C.fail("That data description isn't yours, or it was deleted.")
        r.update(name=name, columns=spec["columns"], settings=settings, updated=C.now())
    else:
        if len(app_tables.datasets.search(owner=me)) >= MAX_DATASETS:
            return C.fail("You have %d saved data descriptions. Delete a few first." % MAX_DATASETS)
        if C.rate_limited("save_dataset", 60, 3600):
            return C.fail("That's a lot of saving in one hour. Please try again later.")
        r = app_tables.datasets.add_row(owner=me, name=name, columns=spec["columns"], settings=settings,
                                        created=C.now(), updated=C.now(), is_demo=False)
    return C.ok(dataset=dataset_dict(r))


@anvil.server.callable(require_user=True)
def delete_dataset(dataset_id):
    me = C.require_user()
    r = C.row_by_id(app_tables.datasets, dataset_id)
    if r is None:
        return C.ok()
    if r["owner"] != me:
        return C.fail("You can only delete your own data descriptions.")
    r.delete()
    return C.ok()


# ------------------------------------------------------------------------------------------- listings
@anvil.server.callable
def get_snippet(snippet_id):
    """Anyone may read a public listing; a private one only its owner (and admins, for moderation)."""
    me = C.me()
    r = C.row_by_id(app_tables.snippets, snippet_id)
    if r is None:
        return C.fail("This listing doesn't exist (any more).")
    if not r["is_public"] and (me is None or (r["owner"] != me and not C.is_admin(me))):
        return C.fail("This listing is private.")
    return C.ok(snippet=snippet_full(r, me))


@anvil.server.callable(require_user=True)
def save_snippet(snippet_id, data):
    """Create (snippet_id None) or update one of your listings. data: title, model, task, spec, files, notes,
    tags, starred, is_public. Fields left out of data keep their value on an update."""
    me = C.require_user()
    if not isinstance(data, dict):
        return C.fail("Nothing to save.")
    r = None
    if snippet_id:
        r = _own(app_tables.snippets, snippet_id, me)
        if r is None:
            return C.fail("That listing isn't yours, or it was deleted.")
    ch = {}
    if "title" in data or r is None:
        ch["title"] = C.text(data.get("title"), 120)
        if len(ch["title"]) < 2:
            return C.fail("Give the listing a title (at least 2 characters).")
    if "model" in data or r is None:
        ch["model"] = Specs.clean_model(data.get("model"))
        if not ch["model"]:
            return C.fail("Pick a model first.")
    if "spec" in data or r is None:
        ch["spec"] = Specs.clean_spec(data.get("spec"))
        if ch["spec"] is None:
            return C.fail("The data description is missing.")
        ch["task"] = ch["spec"]["task"]
    if "files" in data:
        ch["files"] = Specs.clean_files(data.get("files"))
    if "notes" in data:
        ch["notes"] = C.text(data.get("notes"), 4000, multiline=True)
    if "tags" in data:
        ch["tags"] = Specs.clean_tags(data.get("tags"))
    if "starred" in data:
        ch["starred"] = bool(data.get("starred"))
    if "is_public" in data:
        ch["is_public"] = bool(data.get("is_public"))
    ch["updated"] = C.now()
    if r is None:
        if len(app_tables.snippets.search(owner=me)) >= MAX_SNIPPETS:
            return C.fail("Your notebook holds %d listings already. Delete a few first." % MAX_SNIPPETS)
        if C.rate_limited("save_snippet", 60, 3600):
            return C.fail("That's a lot of listings in one hour. Please try again later.")
        base = {"notes": "", "tags": [], "starred": False, "is_public": False, "files": None}
        base.update(ch)
        r = app_tables.snippets.add_row(owner=me, cites=0, created=C.now(), is_demo=False, **base)
    else:
        r.update(**ch)
    return C.ok(snippet=snippet_full(r, me))


@anvil.server.callable(require_user=True)
def delete_snippet(snippet_id):
    me = C.require_user()
    r = C.row_by_id(app_tables.snippets, snippet_id)
    if r is None:
        return C.ok()
    if r["owner"] != me and not C.is_admin(me):
        return C.fail("You can only delete your own listings.")
    for child in app_tables.snippets.search(forked_from=r):
        child["forked_from"] = None
    r.delete()
    return C.ok()


@anvil.server.callable(require_user=True)
def fork_snippet(snippet_id):
    """Copy a public listing (or one of your own) into your notebook. Forking someone else's cites it."""
    me = C.require_user()
    src = C.row_by_id(app_tables.snippets, snippet_id)
    if src is None or (not src["is_public"] and src["owner"] != me):
        return C.fail("That listing isn't available to copy.")
    if len(app_tables.snippets.search(owner=me)) >= MAX_SNIPPETS:
        return C.fail("Your notebook holds %d listings already. Delete a few first." % MAX_SNIPPETS)
    if C.rate_limited("fork_snippet", 40, 3600):
        return C.fail("That's a lot of copying in one hour. Please try again later.")
    title = C.text("Copy of " + src["title"], 120) if src["owner"] == me else src["title"]
    r = app_tables.snippets.add_row(owner=me, title=title, model=src["model"], task=src["task"], spec=src["spec"],
                                    files=src["files"], notes=src["notes"] or "", tags=list(src["tags"] or []),
                                    starred=False, is_public=False, cites=0, forked_from=src,
                                    created=C.now(), updated=C.now(), is_demo=False)
    if src["owner"] != me:
        src["cites"] = int(src["cites"] or 0) + 1
    return C.ok(snippet=snippet_full(r, me))
