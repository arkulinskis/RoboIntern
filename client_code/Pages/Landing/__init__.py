from anvil import *

from ._anvil_designer import LandingTemplate
from ... import ri, state

# The app's video on the Addanapp YouTube channel (APP_MAKER/youtube/manifest.json), shown in the Watch section.
YT_VIDEO = "-ZsVXlSr6tI"
SHOWCASE = ["safety-stock", "plant-energy"]  # the two Casebook cases worked out on the page
STRIP = ["lgbm", "arima", "gp"]              # the three typeset models
HERO_EQ = r"\hat y_{T+h} = f\big(y_{\le T},\ \mathbf x^{\text{known}}_{\le T+h}\big)"


class Landing(LandingTemplate):
    """#landing (also "About" for members): the promise with the hero "Figure 1" (columns -> ranking -> code), the
    Watch section (the YouTube video), how it works, what's inside, the Casebook teaser (industries + two worked
    cases), three typeset models, questions. Static copy lives in the template; numbers come from the engine."""

    def __init__(self, args=(), **properties):
        super().__init__(**properties)
        m = ri.meta()
        n = m["counts"]
        self.signup_box.visible = not state.me()
        self.proof_models.text = "%d models, from seasonal naïve to foundation models" % n["models"]
        self.proof_cases.text = "%d business cases in %d industries" % (n["cases"], n["industries"])
        self.feat_cases.text = ("%d situations from factories to hospitals, each linked to its models, the outside signals "
                                "that sharpen it (contracts, weather, events) and the decision it drives." % n["cases"])
        self.cases_lead.text = ("%d business situations, each linked to the models that fit, the outside signals that make "
                                "it sharper than history alone, and the decision it drives. Long, but finite: they all "
                                "come in %d shapes." % (n["cases"], n["shapes"]))
        self.faq_limit.text = (
            "For prediction from tables, yes, and it is smaller than it looks. The Casebook lists %d situations across %d "
            "industries, and each is one of %d shapes: demand, load, event risk, propensity, quality, value, duration, "
            "triage, outliers, metric watch and segmentation. What changes from case to case is the columns, above all "
            "the outside signals you join to your history." % (n["cases"], n["industries"], n["shapes"]))
        self.all_models.text = "All %d models" % n["models"]
        self.hero_eq.tex = HERO_EQ
        self.industry_panel.items = m["industries"]
        self.case_panel.items = [ri.js("caseTeaser", c) for c in SHOWCASE]
        self.math_panel.items = [dict(m["models"][s], eq=ri.eq(s)) for s in STRIP]
        self.dom_nodes["yt_cover"].addEventListener("click", self._play)

    def _play(self, event):
        """Swap the video's cover for YouTube's player (privacy-enhanced); nothing loads from YouTube before this click."""
        self.dom_nodes["yt_frame"].innerHTML = (
            '<iframe src="https://www.youtube-nocookie.com/embed/' + YT_VIDEO + '?autoplay=1&rel=0&playsinline=1" '
            'title="RoboIntern video" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen '
            'referrerpolicy="strict-origin-when-cross-origin"></iframe>')
