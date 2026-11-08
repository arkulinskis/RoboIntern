from anvil import *

from ._anvil_designer import CaseTeaserTemplate
from ... import router, state


class CaseTeaser(CaseTeaserTemplate):
    """A worked Casebook case on the landing page: history columns, outside signals, the first model.
    item = RI.py.caseTeaser(id): {id, ind, no, name, q, model, cols, sig}."""

    def __init__(self, **properties):
        super().__init__(**properties)
        it = self.item
        state.set_attr(self, "href", router.href("cases", it["ind"], it["id"]))
        self.no.text = "Case %s" % it["no"]
        self.cols_panel.items = [{"text": c, "kind": "code"} for c in it["cols"]]
        self.sig_panel.items = [{"text": s, "kind": "sig"} for s in it["sig"]]
