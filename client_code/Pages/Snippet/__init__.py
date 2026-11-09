import json

import anvil.server
from anvil import *
from anvil.js import window

from ._anvil_designer import SnippetTemplate
from ... import ri, router, state

FILES = {"train": "train.py", "predict": "predict.py", "requirements": "requirements.txt"}


class Snippet(SnippetTemplate):
    """#snippet/<id>: one listing. Anyone can read a public one; the owner can edit the title, notes, tags and the
    code itself, star it, publish it to the Commons, regenerate it, or delete it. Others can fork it.
    A listing with files = None (the demo ones) is written live from its spec + model by the engine (RI.generate).
    Server: get_snippet (checked here: not found / private gets a friendly page), save_snippet, delete_snippet,
    fork_snippet."""

    def __init__(self, args=(), **properties):
        super().__init__(**properties)
        self.s = {}
        self.files = {}
        self.live = False
        self.editing = ""
        state.heading(self.title, 1)
        state.set_control_attr(self.code_box, "spellcheck", "false")
        self.missing.visible = self.body.visible = False
        if not args:
            router.go(router.HOME if state.me() else "commons")
            return
        r = anvil.server.call("get_snippet", args[0])
        if not r.get("ok"):
            self.missing_title.text = r.get("error") or "This listing isn't available."
            state.heading(self.missing_title, 1)
            self.missing.visible = True
            return
        self.set_from(r["snippet"])
        self.dom_nodes_tab()

    def dom_nodes_tab(self):
        """Tab in the code editor indents (four spaces) instead of leaving the box."""
        box = state.control(self.code_box)
        if box is not None:
            box.addEventListener("keydown", self._tab_key)

    def _tab_key(self, e):
        if getattr(e, "key", None) == "Tab" and not getattr(e, "shiftKey", False):
            e.preventDefault()
            ta = e.target
            a = ta.selectionStart
            ta.value = ta.value[:a] + "    " + ta.value[ta.selectionEnd:]
            ta.selectionStart = ta.selectionEnd = a + 4

    # ---- data
    def set_from(self, snip):
        self.s = s = snip
        self.live = not s.get("files") or not s["files"].get("train")
        if self.live:
            self.files = ri.js("generate", json.dumps(s["spec"]), s["model"], s["title"]) or {
                "train": "# This model is no longer in RoboIntern.", "predict": "", "requirements": ""}
        else:
            self.files = s["files"]
        self.editing = ""
        self.draw()

    def persist(self, data, msg=None):
        r = state.call("save_snippet", self.s["id"], data)
        if r is not None:
            self.set_from(r["snippet"])
            if msg:
                state.toast(msg, "ok")
        return r

    # ---- drawing
    def draw(self):
        s = self.s
        self.body.visible = True
        m = ri.model(s["model"]) or {"name": s["model"], "slug": s["model"], "tmpl": ""}
        window.document.title = s["title"] + " · RoboIntern"
        mine = bool(s.get("can_edit"))
        state.set_attr(self.back_link, "href", "#notebook" if mine else "#commons")
        self.back_text.text = "Notebook" if mine else "Commons"
        state.set_attr(self.model_link, "href", router.href("atlas", "model", m.get("slug") or s["model"]))
        self.model_name.text = m["name"]
        badges = [{"text": ri.task_name(s["task"]), "kind": "meta"},
                  {"text": "public", "kind": "good"} if s.get("is_public") else {"text": "private", "kind": "badge"}]
        if s.get("demo"):
            badges.append({"text": "demo", "kind": "badge"})
        self.badge_panel.items = badges
        self.title.text = s["title"]
        byline = [{"text": "by " + (s.get("author") or ""), "kind": "meta"}, {"text": "updated " + state.ago(s.get("updated")), "kind": "meta"}]
        if s.get("cites"):
            byline.append({"text": "cited %d×" % s["cites"], "kind": "meta"})
        byline += [{"text": "#" + t, "kind": "meta"} for t in s.get("tags") or []]
        self.byline_panel.items = byline
        src = s.get("forked_from")
        self.fork_line.visible = bool(src)
        if src:
            state.set_attr(self.fork_link, "href", router.href("snippet", src["id"]))
            self.fork_title.text = src["title"]
            self.fork_author.text = "by " + src["author"]
        # actions
        self.star_button.visible = self.public_button.visible = self.meta_button.visible = mine
        self.fork_button.visible = not mine
        self.delete_button.visible = bool(s.get("can_delete"))
        self.star_button.text = "★ Starred" if s.get("starred") else "☆ Star"
        state.set_control_attr(self.star_button, "aria-pressed", "true" if s.get("starred") else "false")
        self.public_button.text = "Make private" if s.get("is_public") else "Share in the Commons"
        self.public_button.role = ["btn", "btn-sm", "ic-lock" if s.get("is_public") else "ic-share"]
        self.notes_box.visible = bool(s.get("notes"))
        self.notes.text = s.get("notes") or ""
        # code
        self.live_line.visible = self.live
        self.live_text.text = ("Written live from the data description by today’s RoboIntern."
                               + (" Edit the code to keep your own version." if mine else ""))
        editing = bool(self.editing)
        self.edit_part.visible = editing
        self.code.visible = not editing
        self.regen_line.visible = mine and not self.live and not editing
        if editing:
            self.edit_file.text = FILES[self.editing]
            self.code_box.text = self.files.get(self.editing) or ""
            self.save_code_button.text = "Save " + FILES[self.editing]
            state.set_control_attr(self.code_box, "aria-label", "Edit " + FILES[self.editing])
        else:
            self.code.show(self.files, "train", {"title": s["title"], "model": s["model"], "spec": s["spec"],
                                                 "notes": s.get("notes") or ""}, mine)
        # data description
        v = ri.js("specView", json.dumps(s["spec"] or {}), s["task"])
        self.notation.tex = v["notation"]
        self.cols_panel.items = v["columns"]
        self.freq_line.text = v["freq"]
        self.freq_line.visible = bool(v["freq"])
        self.data_file.text = v["file"] or "data.csv"
        self.predict_cmd.text = "python predict.py" + ("" if v["task"] == "forecast" or m.get("tmpl") == "anomts" else " new.csv")

    # ---- actions
    @handle("code", "edit_code")
    def code_edit_code(self, file="train", **event_args):
        self.editing = file or "train"
        self.draw()
        self.code_box.focus()

    @handle("cancel_button", "click")
    def cancel_button_click(self, **event_args):
        self.editing = ""
        self.draw()

    @handle("save_code_button", "click")
    def save_code_button_click(self, **event_args):
        files = {k: self.files.get(k) or "" for k in FILES}
        files[self.editing] = self.code_box.text or ""
        self.save_code_button.enabled = False
        try:
            self.persist({"files": files}, "Saved")
        finally:
            self.save_code_button.enabled = True

    @handle("star_button", "click")
    def star_button_click(self, **event_args):
        self.persist({"starred": not self.s.get("starred")})

    @handle("public_button", "click")
    def public_button_click(self, **event_args):
        going = not self.s.get("is_public")
        text = ("Everyone can see the title, notes, tags, column names and code, with your name, and fork a copy."
                if going else "It disappears from the Commons. Copies others already forked stay theirs.")
        if confirm(text, title="Share in the Commons?" if going else "Make it private?",
                   buttons=[("Cancel", False), ("Share" if going else "Make private", True)], role="app-dialog"):
            self.persist({"is_public": going}, "Shared in the Commons" if going else "Now private")

    @handle("meta_button", "click")
    def meta_button_click(self, **event_args):
        from ...Dialogs.EditDetails import EditDetails
        snip = alert(EditDetails(snippet=self.s), buttons=[], role="app-dialog", dismissible=True)
        if snip:
            self.set_from(snip)

    @handle("regen_button", "click")
    def regen_button_click(self, **event_args):
        if confirm("Your edits to all three files are replaced by a fresh listing from the data description.",
                   title="Regenerate the code?", buttons=[("Cancel", False), ("Regenerate", True)], role="app-dialog"):
            s = self.s
            self.persist({"files": ri.js("generate", json.dumps(s["spec"]), s["model"], s["title"])}, "Regenerated")

    @handle("lab_button", "click")
    def lab_button_click(self, **event_args):
        state.store_set("lab-load", {"spec": self.s["spec"], "model": self.s["model"]})
        router.go("lab")

    @handle("fork_button", "click")
    def fork_button_click(self, **event_args):
        if not state.me():
            router.remember_after(window.location.hash)
            state.toast("Sign in to fork listings into your notebook")
            router.go("auth", "signup")
            return
        self.fork_button.enabled = False
        try:
            r = state.call("fork_snippet", self.s["id"])
        finally:
            self.fork_button.enabled = True
        if r is not None:
            state.toast("Forked into your notebook", "ok")
            router.go("snippet", r["snippet"]["id"])

    @handle("delete_button", "click")
    def delete_button_click(self, **event_args):
        if confirm("This can’t be undone.", title="Delete this listing?",
                   buttons=[("Cancel", False), ("Delete", True)], role="app-dialog"):
            if state.call("delete_snippet", self.s["id"]) is not None:
                state.toast("Deleted")
                router.go("notebook" if self.s.get("can_edit") else "commons")
