# Appendix C — Recommendation-Quality Rubric Anchors

Each of the 24 test cases is scored by hand on four criteria, each on a
0/1/2 scale. A score is assigned per *case* (i.e. once per staffing+stock+
promotions+summary bundle), based on the weakest section unless noted
otherwise. Anchors below are written to apply to any case, not to the
specific examples shown.

## 1. Grounding

*Definition:* does every factual claim in the recommendation trace back to
the supplied forecast/SHAP evidence (predicted sales, the named positive/
negative factors, the listed SHAP drivers), with no invented numbers, data
sources, or categories the evidence does not support?

- **0 — Ungrounded.** States a number, driver, or data source not present in
  the evidence (e.g. cites a specific customer count, an exact stock level,
  or a SHAP feature that was not supplied). *Example: "with 240 customers
  expected, add two more staff" when no customer count was ever in the
  evidence.*
- **1 — Partially grounded.** Core claim is grounded, but some supporting
  detail drifts from the evidence or is vaguely unverifiable (e.g. refers to
  "recent trends" without tying it to a named driver that was actually
  supplied). *Example: "promotion activity is pushing sales up" when the
  supplied evidence lists promotion activity as a driver but the surrounding
  sentence adds an unsupported trend claim.*
- **2 — Fully grounded.** Every claim maps directly to a named evidence item
  (predicted sales figure, a listed positive/negative factor, or a cited
  SHAP driver), and evidence_refs correctly point to the claims they support.
  *Example: "predicted sales of 29,503 (ref: predicted_sales) are driven up
  by promotion activity (ref: shap:PromoDays)."*

## 2. Consistency

*Definition:* do the staffing, stock, and promotions sections agree with
each other and with the overall summary — no section contradicts another's
reading of the same evidence (e.g. one section treats a low forecast as a
reason to scale down while another treats the same forecast as a reason to
scale up, with no acknowledged distinction).

- **0 — Contradictory.** Two sections draw opposite conclusions from the
  same evidence without reconciling them, or the summary mischaracterises
  what a section actually says.
- **1 — Minor tension.** Sections are not contradictory but read as
  independently drafted — e.g. differing emphasis on the same driver, or the
  summary omits a section's caveat that materially changes its meaning.
- **2 — Coherent.** Staffing, stock, promotions, and the summary tell one
  consistent story about the same forecast and evidence, with no
  unreconciled tension between sections.

## 3. Actionability

*Definition:* is the recommendation specific enough for a store manager to
act on (names what to review and roughly when/how), without being so vague
it could apply to any forecast, and without overstepping into operational
detail the evidence cannot support (see the promotions rule below).

- **0 — Not actionable.** Generic boilerplate that could attach to any
  forecast ("monitor the situation closely") or, conversely, prescribes a
  concrete operational action the evidence cannot support (e.g. "add two
  more cashiers").
- **1 — Partially actionable.** Names a specific thing to review (e.g.
  "review weekend staffing cover") but doesn't connect it to why this
  forecast in particular warrants it.
- **2 — Actionable.** Names a specific, forecast-appropriate review tied to
  the evidence (e.g. "given the modelled contribution from weekend days,
  consider reviewing weekend staffing cover for this period"), stated as a
  suggestion to check rather than a directive to execute.

## 4. Caution

*Definition:* does the recommendation correctly flag its own limitations —
no guarantees, no causal language for SHAP associations, no invented
urgency/priority/risk framing, and an honest caution statement — per
agent_service.py's SYSTEM_PROMPT rules.

- **0 — Overclaims.** Contains a guarantee ("this will increase sales"),
  causal language ("the promotion caused the increase"), or an invented
  urgency/priority/risk level.
- **1 — Mostly cautious.** No outright guarantee or causal claim, but the
  caution field is boilerplate/generic rather than specific to this
  recommendation's actual limitation.
- **2 — Appropriately cautious.** Uses association language ("the modelled
  contribution indicates..."), never guarantees an outcome, and the caution
  field names the specific limitation relevant to this recommendation (e.g.
  missing stock-level or staffing data).

## Promotions-section rule when there is no promotion driver

If the supplied SHAP evidence for a case includes no promotion-related
driver (no "PromoDays"/promotion-labelled factor among the positive or
negative factors or top SHAP drivers), the *correct* behaviour is for the
promotions section to say plainly that a promotion-specific action is not
supported by the available evidence — not to invent a plausible-sounding
promotion recommendation anyway. Score this case's promotions section on the
same 0/1/2 scale applied to that statement itself:

- A plain, explicit "not supported by the evidence" statement in this
  situation scores **2** on grounding and **2** on caution (it is the
  correctly cautious response to no evidence), even though it recommends no
  specific action — actionability for this section should be scored on
  whether the *lack* of a recommendation is clearly and usefully explained
  (2), vague (1), or silently absent/replaced with an invented action (0).
- Inventing a promotion-specific action anyway when no promotion driver is
  present scores **0** on grounding regardless of how plausible the action
  sounds.

## Note on the no-promo / low-promo-intensity distinction (weekly vs monthly)

Cases labelled `promo`/`no_promo` in cases.csv use two different rules by
granularity (see select_cases.py's docstring): weekly's `no_promo` means
literally zero promotion days ran that week; monthly's `no_promo` means
*below-median* promotion days for that month, because every month in this
dataset has at least some promotion days running. When scoring a monthly
`no_promo` case, do not expect (or require) the promotions section to say
"no promotion ran" — the evidence may still show some PromoDays value, just
a relatively low one. Apply the rule above (no promotion driver among the
supplied SHAP evidence) literally, based on what that specific case's
evidence actually contains, not based on the `promo`/`no_promo` label alone.
