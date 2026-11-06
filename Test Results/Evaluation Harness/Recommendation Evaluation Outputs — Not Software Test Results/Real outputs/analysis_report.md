# Table 5.x — Recommendation-quality evaluation results

### Overall (mean / SD per criterion, n=24)

| criterion | mean | std |
| --- | --- | --- |
| grounding | 1.750 | 0.442 |
| consistency | 1.625 | 0.495 |
| actionability | 1.542 | 0.509 |
| caution | 1.875 | 0.338 |

### By granularity

| granularity /  | grounding / mean | grounding / std | consistency / mean | consistency / std | actionability / mean | actionability / std | caution / mean | caution / std |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| monthly | 1.750 | 0.452 | 1.667 | 0.492 | 1.500 | 0.522 | 1.833 | 0.389 |
| weekly | 1.750 | 0.452 | 1.583 | 0.515 | 1.583 | 0.515 | 1.917 | 0.289 |

### By promo x high/low cell

| granularity /  | promo /  | high_low /  | grounding / mean | grounding / std | consistency / mean | consistency / std | actionability / mean | actionability / std | caution / mean | caution / std |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| monthly | no_promo | high | 2.000 | 0.000 | 1.667 | 0.577 | 1.333 | 0.577 | 2.000 | 0.000 |
| monthly | no_promo | low | 1.667 | 0.577 | 1.667 | 0.577 | 1.333 | 0.577 | 1.667 | 0.577 |
| monthly | promo | high | 1.667 | 0.577 | 1.667 | 0.577 | 1.667 | 0.577 | 1.667 | 0.577 |
| monthly | promo | low | 1.667 | 0.577 | 1.667 | 0.577 | 1.667 | 0.577 | 2.000 | 0.000 |
| weekly | no_promo | high | 1.667 | 0.577 | 1.333 | 0.577 | 1.667 | 0.577 | 2.000 | 0.000 |
| weekly | no_promo | low | 1.667 | 0.577 | 1.667 | 0.577 | 1.333 | 0.577 | 2.000 | 0.000 |
| weekly | promo | high | 2.000 | 0.000 | 1.667 | 0.577 | 1.667 | 0.577 | 2.000 | 0.000 |
| weekly | promo | low | 1.667 | 0.577 | 1.667 | 0.577 | 1.667 | 0.577 | 1.667 | 0.577 |

### Auto-check pass rates

| check | metric | value |
| --- | --- | --- |
| flag_causal_language | flagged_rate | 0.000 |
| flag_invented_quantities | flagged_rate | 0.000 |
| flag_urgency_priority_risk_language | flagged_rate | 0.000 |
| flag_realised_data_mentions | flagged_rate | 0.042 |
| flag_guarantee_language | flagged_rate | 0.083 |
| flag_numeric_grounding | flagged_rate | 0.500 |
| evidence_refs_allowlist_share | pass_rate | 1.000 |
| evidence_refs_nonempty | pass_rate | 1.000 |
| generation_succeeded | pass_rate | 1.000 |
| sections_present | pass_rate | 1.000 |

### Intra-rater agreement on the 6 re-scored cases

| criterion | n | exact_agreement_pct | weighted_kappa | note |
| --- | --- | --- | --- | --- |
| grounding | 6 | 83.333 | 0.000 | second-pass scores were constant on this criterion; weighted_kappa is forced toward 0 by construction (the "kappa paradox") and is not a meaningful reliability estimate here — see exact_agreement_pct instead |
| consistency | 6 | 83.333 | 0.000 | second-pass scores were constant on this criterion; weighted_kappa is forced toward 0 by construction (the "kappa paradox") and is not a meaningful reliability estimate here — see exact_agreement_pct instead |
| actionability | 6 | 16.667 | -0.364 |  |
| caution | 6 | 66.667 | 0.000 | second-pass scores were constant on this criterion; weighted_kappa is forced toward 0 by construction (the "kappa paradox") and is not a meaningful reliability estimate here — see exact_agreement_pct instead |

### Failed generations

None.

## Limitations

This evaluation has a small number of structural limitations that should be
read alongside the scores in Table 5.x:

- **Single rater.** All 24 cases were scored by one person (the author).
  There is no independent second rater, so the agreement figures reported
  here are *intra*-rater (the same person scoring the same 6 cases twice,
  with case identities hidden on the second pass), not *inter*-rater
  agreement between different judges.
- **Scoring interval.** The first-pass and blind-rescore passes were
  completed close together in time, not separated by the several days
  originally planned. Beyond the identity-blinding already in place, this
  raises the risk that the second pass was influenced by memory of the
  first, and should be read as a secondary caveat on the agreement
  figures above.
- **One generation per case.** Each case was generated exactly once, not
  averaged or sampled across multiple generations. Variance across repeated
  generations of the same case was not measured, so scores reflect a single
  sample of the model's output distribution per case, not its central
  tendency.
- **n = 24.** Twelve weekly and twelve monthly cases, stratified by
  predicted-sales level and promotion status (see select_cases.py and
  rubric_anchors.md for the exact stratification and the weekly/monthly
  promo-definition difference). This is enough to check for gross failure
  modes across the stratified cells, not enough to support strong
  statistical claims about population-level recommendation quality.
- **The evidence_refs_allowlist_share auto-check is post-filter only.**
  agent_service.get_recommendations() already drops any evidence reference
  not in the allowlist before this harness ever sees the output, so that
  check can only ever report 1.0 by construction — it confirms the filter is
  working, not what the model originally cited before filtering.
- **Weighted kappa is near-zero on grounding, consistency, caution despite high exact
  agreement, because one of the two rescore passes used a single constant
  score on that criterion.** This is the well-known "kappa paradox": when a
  rater's marginal distribution collapses to one category, the chance-agreement
  term in Cohen's kappa collapses to the observed agreement rate, forcing kappa
  toward 0 regardless of how well the two passes actually align. Read
  exact_agreement_pct for these criteria instead of weighted_kappa.
