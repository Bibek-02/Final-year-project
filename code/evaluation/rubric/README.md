# Recommendation-quality evaluation harness

Evidence for thesis Section 3.6.5, Appendix C, and Chapter 5. Evaluates
`backend/app/services/agent_service.get_recommendations()` output quality on
24 deterministic test cases (12 weekly + 12 monthly), using the real
precomputed forecast/SHAP artifacts and the real prompt-building code — no
app behaviour, prompts, or schemas are modified by anything here.

All scripts are run from the repo root (`code/`) with the same Python used
by `backend/` (see `backend/requirements.txt`; no new dependencies added).
Everything is deterministic (`random_state=42`).

## Current status

- **Live generation:** done for all 24 cases with `claude-opus-5`. The results are in `outputs/results.jsonl`.
- **Hand scoring:** both passes are complete. `scoresheet.csv` holds all 24 cases, and `rescore_subset.csv` holds the 6 blind re-scores.
- **Analysis:** done. The results tables and limitations are in `outputs/analysis_report.md`.
- **Harness tests:** the recorded run passed 24 of 24. The log is in `../../../Test Results/Evaluation Harness/` and in `../../evidence/`.

## Folder layout

| Folder | What it does |
|---|---|
| `evaluation/` | Top-level folder for evaluation work. It holds only `rubric/`. |
| `rubric/` | The harness: scripts that select cases, generate recommendations, run automatic checks, build scoring packets and analyse the scores. |
| `rubric/tests/` | pytest suite for the harness scripts. Claude is replaced by the dry-run stub, so no API key or network is needed. |
| `rubric/outputs/` | Every generated file: cases, recommendations, automatic checks, score sheets and analysis. See the next table. |
| `rubric/outputs/packets/` | 24 readable scoring packets, one per case. Each shows the case details, the evidence given to the agent and its recommendation. |
| `rubric/outputs/packets_rescore/` | 6 blind packets (`R1.md` to `R6.md`) for the second scoring pass. Store, period and granularity are removed. |

## Output files

| File | Contents |
|---|---|
| `cases.csv` | The 24 selected cases: store, period, granularity, promotion and high/low predicted sales |
| `results.jsonl` | Real recommendations from the live run, with the inputs given to the agent |
| `results_dryrun.jsonl` | Stubbed placeholder recommendations used for testing the pipeline. Not real results |
| `auto_checks.csv` | Pass/fail and flagged-for-review automatic checks for each case |
| `scoresheet.csv` | First-pass hand scores (0/1/2) on grounding, consistency, actionability and caution |
| `rescore_subset.csv` | Blind second-pass scores for 6 cases |
| `rescore_mapping.csv` | Links `R1` to `R6` back to case IDs. Read only by `analyse.py`, after scoring |
| `scoring_aid_example_monthly_101_2015-06-01.md` | Worked example of scoring one case |
| `analysis_summary_overall.csv`, `analysis_summary_by_granularity.csv`, `analysis_summary_by_cell.csv` | Mean and standard deviation of the scores, overall and broken down |
| `analysis_auto_checks.csv` | Automatic-check pass and flag rates |
| `analysis_agreement.csv` | Agreement between the first and second scoring passes |
| `analysis_failures.csv` | Failed generations (none) |
| `analysis_report.md` | All results tables plus the limitations |

## Phase A — no live API calls

```
python evaluation/rubric/select_cases.py          # -> outputs/cases.csv (24 cases)
python evaluation/rubric/generate.py --dry-run     # -> outputs/results_dryrun.jsonl (stubbed Claude client, no key/network)
python evaluation/rubric/auto_checks.py            # -> outputs/auto_checks.csv
python evaluation/rubric/make_scoresheet.py        # -> outputs/scoresheet.csv, rescore_subset.csv, rescore_mapping.csv
python evaluation/rubric/make_packets.py           # -> outputs/packets/*.md, outputs/packets_rescore/R1..R6.md
python -m pytest evaluation/rubric/tests -v
python -m pytest backend/tests -q                  # confirm the app's own suite is untouched
```

`rubric_anchors.md` (Appendix C) is static — nothing to run for it.

## Phase B — live generation (only after explicit approval)

```
python evaluation/rubric/generate.py --preflight   # ONE minimal live call — confirms AGENT_MODEL is accepted
python evaluation/rubric/generate.py               # live generation, all 24 cases -> outputs/results.jsonl
python evaluation/rubric/auto_checks.py
python evaluation/rubric/make_scoresheet.py
python evaluation/rubric/make_packets.py
```

`generate.py` (live mode) refuses to overwrite an existing `outputs/results.jsonl`
unless `--force` is passed — a live run costs real API calls, so a second
accidental run can't silently clobber it. `--dry-run`'s output
(`results_dryrun.jsonl`) has no such protection; it's a stub and is always
freely regenerated. Everything downstream (`auto_checks.py`, `make_packets.py`,
`analyse.py`) reads `results.jsonl` if it exists, falling back to
`results_dryrun.jsonl` otherwise (`common.default_results_path()`).

**Caution:** the score sheets are now filled in. `make_scoresheet.py` overwrites `scoresheet.csv`, `rescore_subset.csv` and `rescore_mapping.csv` with blank versions without asking, so don't rerun it unless you have a backup of the scores.

At this point `scoresheet.csv`, `rescore_subset.csv`, and the human-readable
`outputs/packets/*.md` / `outputs/packets_rescore/R1..R6.md` packets are ready
for hand scoring (0/1/2 per criterion, using `rubric_anchors.md`).
`rescore_mapping.csv` (and the identifying header in each full packet) should
not be consulted while filling in `rescore_subset.csv` from the
`packets_rescore/` files — the mapping exists only so `analyse.py` can join
the blind re-score back to the first pass afterwards; `make_packets.py` itself
never reads `rescore_mapping.csv` to build the blind packets, and it strips
the case's store id/period/granularity out of the evidence text they show.

Optionally, to read all packets in one file while scoring:

```
python evaluation/rubric/combine_packets.py        # -> outputs/all_packets.md, outputs/all_packets_rescore.md
```

Once both score sheets are filled in and saved back into `outputs/`:

```
python evaluation/rubric/analyse.py
```

This writes `outputs/analysis_summary_*.csv`, `analysis_auto_checks.csv`,
`analysis_agreement.csv`, `analysis_failures.csv`, and a combined
`analysis_report.md` (the Table 5.x source + a limitations paragraph).

## Files

| File | Purpose |
|---|---|
| `common.py` | Shared backend-path/artifact-loading setup (not a standalone script). |
| `select_cases.py` | Picks the 24 stratified test cases -> `cases.csv`. |
| `generate.py` | Runs `get_recommendations()` per case (`--dry-run` / live / `--preflight` / `--force`) -> `results_dryrun.jsonl` or `results.jsonl`. |
| `auto_checks.py` | Objective pass/fail + flagged-for-review heuristic checks over the results file -> `auto_checks.csv`. |
| `rubric_anchors.md` | Appendix C: 0/1/2 scoring anchors for the 4 criteria. |
| `make_scoresheet.py` | Builds the blank `scoresheet.csv` + blind `rescore_subset.csv`/`rescore_mapping.csv`. |
| `make_packets.py` | Builds human-readable `packets/*.md` (full) and `packets_rescore/R1..R6.md` (blind, de-identified). |
| `combine_packets.py` | Joins the packets into `all_packets.md` and `all_packets_rescore.md` for easier reading. Optional; the score sheets stay the record. |
| `analyse.py` | Aggregates hand scores + auto-checks into thesis-ready tables. |
| `tests/` | pytest suite for `select_cases`/`generate --dry-run`/`auto_checks`/`make_packets`. |
| `outputs/` | All generated CSV/JSONL/MD artefacts (see [Output files](#output-files)). |

## On `outputs/` and secrets

Nothing under `outputs/` is sensitive: `results.jsonl` holds generated
business-advice text and the exact (non-secret) prompt/evidence inputs, not
credentials. It is intentionally **not** gitignored. No script here opens,
prints, or logs `backend/.env` or the Anthropic API key — `generate.py`
loads config exactly the way the app does (via `app.config.settings`,
instantiated with CWD set to `backend/`, same as `uvicorn`/`pytest` do) and
never reads the key value itself.
