# Scoring aid — monthly_101_2015-06-01

This is an example of a per-packet scoring aid: mechanical cross-checks only
(does a claim trace to the evidence block?), no judgment calls. If this
format is useful, I'll generate one per case for all 24.

## Grounding cross-reference

Claims made in the Recommendation text, checked against the evidence block:

| Claim (section) | Evidence check |
|---|---|
| "~197,232 units for June 2015" (Staffing) | matches `predicted_sales` = 197,232 — found in evidence |
| "6-month and 3-month weighted sales trends... close to the predicted level" (Staffing) | `shap:EMA_6`=9918.35 (value 194,206.39), `shap:EMA_3`=8476.40 (value 191,493.92) — both found in evidence, both positive |
| "same period last year and the month-of-year feature is negative" (Staffing) | `shap:sales_lag_12`=-5491.65, `shap:Month`=-639.03 — both found, both negative, matches claim |
| "average of the previous six months (about 198,772)" (Stock) | `shap:rolling_mean_6` value = 198,771.83 — found in evidence, rounds to 198,772 ✓ |
| "rolling_std_3, value around 8,906" (Stock) | `shap:rolling_std_3` value = 8,906.41 — found in evidence ✓ |
| "None of the supplied SHAP drivers... relate to promotions" (Promotions) | checked: allowed evidence ids for this case are `EMA_3, EMA_6, Month, TimeIndex, rolling_mean_6, rolling_std_3, sales_lag_12, sales_lag_2` — none contain "promo" ✓ matches rubric_anchors.md's no-promo-driver rule |

No numeric or factual claim in this packet was found to be untraceable to the
evidence block. (This matches `auto_checks.csv`: this case was NOT among the
12 flagged by `flag_numeric_grounding`.)

## Consistency check (read the 3 sections + summary together)

- Staffing, Stock, and the Summary all describe the same reading of the
  forecast (flat vs. recent 6-month trend, no step change) — no section
  contradicts another on this point. [Does this match your own read? Y/N: __]
- Promotions explicitly states no promo driver is present, and the Summary's
  final sentence repeats this — consistent. [Y/N: __]

## Promotions-specific rule (rubric_anchors.md)

No promo-related SHAP ref is in this case's allowed evidence (confirmed
above), so per rubric_anchors.md the *correct* behaviour is exactly what
this packet did: state plainly that promotion-specific action isn't
supported. Score Actionability on whether that explanation itself is clear
(2) / vague (1) / silently missing (0) — not on whether a promo action was
suggested.

## Your scores (fill in 0/1/2 + short note, then copy into scoresheet.csv)

| Criterion | Score (0/1/2) | Note |
|---|---|---|
| Grounding | | |
| Consistency | | |
| Actionability | | |
| Caution | | |
