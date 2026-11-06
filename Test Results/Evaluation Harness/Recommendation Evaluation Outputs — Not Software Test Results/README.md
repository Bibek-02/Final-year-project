# Recommendation Evaluation Outputs

**These are not software test results.** They record the recommendation-quality evaluation, so passed, failed and skipped totals do not apply. All files are unchanged copies from `code/evaluation/rubric/outputs/`.

| Folder | Contents | Source of the recommendations |
|---|---|---|
| `Real outputs/` | `results.jsonl`, cases, automatic checks, hand scores, re-scores and analysis | 24 live generations recorded on 2026-10-07 with model `claude-opus-5` |
| `Dry-run outputs/` | `results_dryrun.jsonl` | Stubbed Claude client. This is placeholder text, not real recommendations or evidence of quality |

**Limitations**, from `Real outputs/analysis_report.md`:
- All 24 cases were scored by one rater.
- Each case was generated once.
- The first scoring pass and the blind re-score were completed close together.
- A sample of 24 cases cannot support strong statistical claims.

**Not recorded:** a console log of the live generation run.

**Left in place:** scoring packets and the scoring aid are scoring inputs, so they remain in `code/evaluation/rubric/outputs/`.

The score and analysis files here are copies of the versions committed in `c384e7d`.
