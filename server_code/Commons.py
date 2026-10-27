"""The Commons: listings members chose to publish. Anyone can browse; members fork them into their notebook
(Notebook.fork_snippet). Admins can unpublish or delete (admin page, Commons tab)."""
import anvil.server
from anvil.tables import app_tables
import anvil.tables as tables

from . import common as C
from . import DemoData
from .Notebook import snippet_meta

SORTS = ("new", "cited")


@anvil.server.callable
def list_commons(query=None, model=None, task=None, sort="new"):
    DemoData.ensure_loaded()
    me = C.me()
    rows = list(app_tables.snippets.search(tables.order_by("updated", ascending=False), is_public=True))
    items = [snippet_meta(r, me) for r in rows]
    models, tasks = {}, {}
    for s in items:
        models[s["model"]] = models.get(s["model"], 0) + 1
        tasks[s["task"]] = tasks.get(s["task"], 0) + 1
    q = C.text(query, 80).lower()
    if q:
        items = [s for s in items if q in (s["title"] + " " + s["notes"] + " " + " ".join(s["tags"]) + " " + s["model"] + " "
                                           + (s["target"] or "") + " " + s["author"]).lower()]
    model = C.text(model, 40)
    if model:
        items = [s for s in items if s["model"] == model]
    task = C.text(task, 20)
    if task:
        items = [s for s in items if s["task"] == task]
    if sort == "cited":
        items.sort(key=lambda s: (-s["cites"], s["updated"] or ""))
    return {"items": items[:90], "total": len(items), "models": models, "tasks": tasks}


@anvil.server.callable(require_user=True)
def admin_commons():
    me = C.require_admin()
    rows = app_tables.snippets.search(tables.order_by("updated", ascending=False), is_public=True)
    return {"items": [snippet_meta(r, me) for r in rows]}


@anvil.server.callable(require_user=True)
def admin_unpublish(snippet_id):
    C.require_admin()
    r = C.row_by_id(app_tables.snippets, snippet_id)
    if r is None:
        return C.fail("That listing no longer exists.")
    r["is_public"] = False
    return C.ok()
