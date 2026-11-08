"""Server tests against the strict mock of Anvil (tools/testing/mock).

    python tools/testing/test_server.py          -> prints ALL OK, or the first failure   (no -I: reads anvil.yaml)

call(name, ...) runs a server function the way the browser does: by name, with require_user enforced,
and the reply must be JSON (a datetime or a row in a reply fails here, like it would break the page).
Add tests for every new server function: the happy path, bad input, and someone who isn't allowed.
"""
import datetime as dt
import importlib
import json
import os
import pathlib
import shutil
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
PROJECT = HERE.parents[1]
_tmp = pathlib.Path(tempfile.mkdtemp())
shutil.copytree(PROJECT / "server_code", _tmp / "app")
(_tmp / "app" / "__init__.py").write_text("")
os.environ["ANVIL_APP_YAML"] = str(PROJECT / "anvil.yaml")  # the mock's tables follow the app's own schema
sys.path[:0] = [str(HERE / "mock"), str(_tmp)]
import anvil.server  # noqa: E402
import anvil.users  # noqa: E402
from anvil.tables import app_tables as T  # noqa: E402

M = {p.stem: importlib.import_module("app." + p.stem) for p in sorted((PROJECT / "server_code").glob("*.py"))}
now = dt.datetime.now(dt.timezone.utc)


def call(name, *args):
    r = anvil.server.call(name, *args)
    json.dumps(r)  # strict: must be JSON-able
    return r


def as_user(row):
    anvil.users.CURRENT[0] = row
    anvil.server.session.use(row.get_id() if row is not None else None)


def denied(name, *args):
    try:
        call(name, *args)
    except anvil.server.PermissionDenied:
        return True
    return False


def ok(r, msg=""):
    assert isinstance(r, dict) and r.get("ok"), (msg, r)
    return r


def bad(r, msg=""):
    assert isinstance(r, dict) and r.get("ok") is False and r.get("error"), (msg, r)
    return r


def person(email, name=None, **kw):
    return T.users.add_row(email=email, enabled=True, signed_up=now, display_name=name, **kw)


# ---------------------------------------------------------------------------------- accounts
admin = person("arkulinskis@gmail.com", "The Admin")
ana = person("ana@example.com", "Ana")
bob = person("bob@example.com")

as_user(None)
assert call("get_me") is None
assert denied("update_profile", "X")
as_user(admin)
assert call("get_me")["is_admin"] is True, "ADMIN_EMAILS become admins on first sign-in"
as_user(ana)
me = call("get_me")
assert me["name"] == "Ana" and me["is_admin"] is False
assert ana["last_seen"] is not None
as_user(bob)
assert call("get_me")["name"] == "Bob", "a name comes from the email when none is set"
bad(call("update_profile", " x "))
assert ok(call("update_profile", "  Bob   Stone "))["me"]["name"] == "Bob Stone"

# ---------------------------------------------------------------------------------- feedback
as_user(None)
bad(call("submit_feedback", "bug", "hi"))
ok(call("submit_feedback", "bug", "The button is broken", "guest@example.com", {"page": "#home", "evil": "x" * 9999}))
fb = T.feedback.search()[0]
assert fb["name"] == "Guest" and fb["email"] == "guest@example.com" and "evil" not in fb["context"] and fb["status"] == "new"
for i in range(4):
    ok(call("submit_feedback", "idea", "Idea number %d" % i))
bad(call("submit_feedback", "idea", "One too many this hour"), "rate limit")
as_user(ana)
ok(call("submit_feedback", "nonsense-kind", "Signed-in feedback"))
assert T.feedback.get(message="Signed-in feedback")["kind"] == "other"
assert denied("list_feedback")
as_user(admin)
lst = call("list_feedback")
assert lst["counts"]["new"] == 6 and len(lst["items"]) == 6
fid = lst["items"][0]["id"]
ok(call("set_feedback_status", fid, "done", "Fixed it"))
assert call("list_feedback", "done")["items"][0]["note"] == "Fixed it"
bad(call("set_feedback_status", fid, "weird"))
bad(call("set_feedback_status", "nope", "done"))
ok(call("delete_feedback", fid))
assert len(call("list_feedback")["items"]) == 5

# ---------------------------------------------------------------------------------- admin
as_user(ana)
for fn, args in [("admin_overview", ()), ("list_users", ()), ("set_admin", (bob.get_id(), True)), ("demo_load", ()), ("demo_remove", ())]:
    assert denied(fn, *args), fn
as_user(admin)
ov = call("admin_overview")
assert ov["users"] == 3 and ov["admins"] == 1 and ov["feedback_new"] == 5 and ov["snippets"] == 0
assert len(call("list_users")["users"]) == 3 and len(call("list_users", "bob")["users"]) == 1
ok(call("set_admin", bob.get_id(), True))
assert bob["is_admin"] is True
bad(call("set_admin", admin.get_id(), False), "can't remove your own admin")
ok(call("set_enabled", bob.get_id(), False))
assert bob["enabled"] is False
bad(call("set_enabled", admin.get_id(), False))
ok(call("set_enabled", bob.get_id(), True))
ok(call("set_admin", bob.get_id(), False))
assert bob["is_admin"] is False

# ---------------------------------------------------------------------------------- demo data + the commons
SPEC = {"columns": [{"name": "date", "type": "datetime", "role": "time"}, {"name": "store", "type": "categorical", "role": "group"},
                    {"name": "promo", "type": "boolean", "role": "feature", "key": True, "known": True},
                    {"name": "sales", "type": "numeric", "role": "target"}, {"name": "evil", "type": "<script>", "role": "boss"}],
        "task": "forecast", "freq": "D", "horizon": 14, "rows": "m", "weights": {"acc": 0.5, "interp": 0.25, "speed": "x"},
        "intervals": True, "file": "sales.csv", "values": [1, 2, 3]}
FILES = {"train": "print('hi')\r\n", "predict": "x = 1", "requirements": "pandas", "junk": "no"}

# the new tasks and the tuning flag survive cleaning; unknown tasks don't
cs = M["Specs"].clean_spec({"columns": [{"name": "amount", "type": "numeric"}], "task": "anomaly", "tune": 1})
assert cs["task"] == "anomaly" and cs["tune"] is True
assert M["Specs"].clean_spec({"task": "cluster"})["task"] == "cluster" and M["Specs"].clean_spec({"task": "evil"})["task"] == "regression"
assert M["Specs"].clean_spec({})["tune"] is False

as_user(None)
com = call("list_commons")
n_demo = len(M["DemoData"].DEMO_SNIPPETS)
assert M["DemoData"].state() == "loaded" and com["total"] == n_demo, "demo loads on first visit"
assert all(not s["mine"] for s in com["items"]) and com["items"][0]["author"]
assert "email" not in json.dumps(com) or "@" not in json.dumps(com), "no emails in the commons"
assert call("list_commons", "churn")["total"] == 2, "search by title"
assert call("list_commons", None, "lgbm")["total"] == 1 and call("list_commons", None, None, "binary")["total"] == 2
cited = call("list_commons", None, None, None, "cited")["items"]
assert cited[0]["cites"] >= cited[-1]["cites"]
demo_id = com["items"][0]["id"]
assert call("get_snippet", demo_id)["snippet"]["files"] is None, "demo listings are generated in the browser"
assert not call("get_snippet", demo_id)["snippet"]["can_edit"]
bad(call("get_snippet", "nope"))
assert denied("get_notebook") and denied("save_snippet", None, {}) and denied("fork_snippet", demo_id) and denied("save_dataset", None, "x", SPEC)

# ---------------------------------------------------------------------------------- notebook: listings
as_user(ana)
nb = call("get_notebook")
assert nb["snippets"] == [] and nb["stats"]["snippets"] == 0
bad(call("save_snippet", None, {"title": "x", "model": "lgbm", "spec": SPEC}), "title too short")
bad(call("save_snippet", None, {"title": "Sales", "model": "Bad Model!", "spec": SPEC}), "bad model slug")
bad(call("save_snippet", None, {"title": "Sales", "model": "lgbm", "spec": "nope"}), "spec must be a dict")
bad(call("save_snippet", None, "nope"))
r = ok(call("save_snippet", None, {"title": "Sales forecast", "model": "lgbm", "spec": SPEC, "files": FILES,
                                   "notes": "My notes", "tags": ["Retail ", "retail", "a b", "x" * 50], "is_public": False}))["snippet"]
sid = r["id"]
assert r["can_edit"] and r["mine"] and not r["is_public"] and r["task"] == "forecast" and r["target"] == "sales"
assert r["files"]["train"] == "print('hi')\n" and "junk" not in r["files"], "files cleaned"
assert r["tags"][0] == "retail" and len(r["tags"]) == 3, r["tags"]
row = T.snippets.get_by_id(sid)
assert row["spec"]["columns"][-1] == {"name": "evil", "type": "numeric", "role": "feature", "key": False, "known": False}
assert "values" not in row["spec"] and row["spec"]["weights"]["speed"] == round(1 / 3.0, 4), "spec cleaned, no sample values"
ok(call("save_snippet", sid, {"starred": True}))
assert T.snippets.get_by_id(sid)["starred"] is True and T.snippets.get_by_id(sid)["title"] == "Sales forecast", "partial update keeps the rest"
nb = call("get_notebook")
assert nb["stats"]["snippets"] == 1 and nb["snippets"][0]["no"] == 1
assert call("get_snippet", sid)["snippet"]["can_edit"]
as_user(bob)
bad(call("get_snippet", sid), "private listings stay private")
bad(call("save_snippet", sid, {"title": "Hijack"}), "can't edit someone else's listing")
bad(call("delete_snippet", sid))
bad(call("fork_snippet", sid), "can't fork a private listing")
as_user(ana)
ok(call("save_snippet", sid, {"is_public": True}))
as_user(None)
assert call("list_commons")["total"] == n_demo + 1 and not call("get_snippet", sid)["snippet"]["can_edit"]
as_user(bob)
fork = ok(call("fork_snippet", sid))["snippet"]
assert fork["mine"] and not fork["is_public"] and fork["forked_from"]["id"] == sid and fork["title"] == "Sales forecast"
assert T.snippets.get_by_id(sid)["cites"] == 1, "forking cites the original"
own = ok(call("fork_snippet", fork["id"]))["snippet"]
assert own["title"].startswith("Copy of") and T.snippets.get_by_id(fork["id"])["cites"] == 0, "copying your own doesn't cite"
ok(call("delete_snippet", own["id"]))
demo_fork = ok(call("fork_snippet", demo_id))["snippet"]
assert demo_fork["files"] is None and demo_fork["spec"]["columns"]

# ---------------------------------------------------------------------------------- notebook: data descriptions
as_user(ana)
bad(call("save_dataset", None, "x", SPEC))
bad(call("save_dataset", None, "Empty", {"columns": []}))
ds = ok(call("save_dataset", None, "Store sales", SPEC))["dataset"]
assert ds["ncols"] == 5 and ds["target"] == "sales" and ds["spec"]["task"] == "forecast" and "values" not in ds["spec"]
ok(call("save_dataset", ds["id"], "Store sales v2", SPEC))
assert [d["name"] for d in call("list_datasets")["datasets"]] == ["Store sales v2"]
as_user(bob)
bad(call("save_dataset", ds["id"], "Mine now", SPEC))
bad(call("delete_dataset", ds["id"]))
assert call("list_datasets")["datasets"] == []
as_user(ana)
ok(call("delete_dataset", ds["id"]))
assert call("list_datasets")["datasets"] == []

# ---------------------------------------------------------------------------------- admin: commons moderation, demo data
as_user(ana)
assert denied("admin_commons") and denied("admin_unpublish", sid)
as_user(admin)
assert len(call("admin_commons")["items"]) == n_demo + 1
ov = call("admin_overview")
assert ov["snippets"] == 3 and ov["public"] == n_demo + 1 and ov["datasets"] == 0
ok(call("admin_unpublish", sid))
bad(call("admin_unpublish", "nope"))
as_user(bob)
bad(call("get_snippet", sid), "unpublished = private again")
assert call("get_snippet", fork["id"])["snippet"].get("forked_from") is None, "a private source isn't linked"
as_user(admin)
assert call("get_snippet", sid)["ok"], "admins can read private listings (moderation)"
ok(call("demo_remove"))
assert M["DemoData"].state() == "removed" and call("list_commons")["total"] == 0, "removing demo data"
assert not T.users.search(is_demo=True)
assert T.snippets.get_by_id(demo_fork["id"])["forked_from"] is None, "a real fork of a demo listing survives its removal"
as_user(None)
call("list_commons")
assert M["DemoData"].state() == "removed", "removed demo data doesn't come back by itself"
as_user(admin)
ok(call("demo_load"))
ok(call("demo_load"))
assert call("list_commons")["total"] == n_demo, "reloading replaces the demo instead of doubling it"
ok(call("delete_snippet", fork["id"]), "admins can delete any listing")
as_user(ana)
ok(call("delete_snippet", sid))
assert call("get_notebook")["snippets"] == []

# ---------------------------------------------------------------------------------- Privacy & Terms
if "legal_server" in M:
    as_user(ana)
    st = call("legal_state")
    assert st["signedIn"] and st["accepted_version"] is None
    ok(call("legal_accept", st["version"], "signup"))
    assert ana["legal_source"] == "signup" and call("legal_state")["accepted_version"] == st["version"]

# ---------------------------------------------------------------------------------- every callable is covered by a permission check
# A callable that changes data without require_user / a C.require_* check is a security hole. List the public ones here.
PUBLIC = {"get_me", "submit_feedback", "list_commons", "get_snippet", "legal_state", "legal_accept"}
for name, (f, need) in sorted(anvil.server.CALLABLES.items()):
    if name in PUBLIC:
        continue
    assert need, "%s is callable by anyone: add require_user=True (or list it in PUBLIC in test_server.py)" % name

print("ALL OK (%d server functions)" % len(anvil.server.CALLABLES))
