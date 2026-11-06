# Evaluation Harness Results

| Item | Record |
|---|---|
| What was tested | The harness code: case selection, dry-run generation, automatic checks and scoring packet creation |
| Run date | 2026-10-16 |
| Totals | 24 passed, 0 failed, 0 skipped |
| Command | `python -m pytest tests/ -v`, run from `code/evaluation/rubric/` |
| Environment | Windows, Python 3.13.4, pytest 9.1.1 (from the log header). Other package versions: Not recorded |
| Code version | Not recorded |

**Important warning (1):** an XGBoost warning about loading a pickled model.

**Mocked:**
- The Claude client, through the dry-run stub
- The output folder, redirected to a temporary path
- Hand-built recommendation records in some tests

**Real:** the files in `model_artifacts/`.

**What this does not show:** these tests check the harness code. They do not verify the recommendation quality or the hand scores.

**Later changes:** no file under `code/evaluation/rubric/` appears to have changed since this run, based on file dates. With the code version not recorded, this cannot be confirmed exactly.

**Files:** `2026-10-16/` holds `evaluation_harness_pytest.txt` and `SUMMARY.md`. `SUMMARY.md` was last modified after the run, so the log is the primary record.

Recommendation evaluation outputs are not software test results, so they are kept in `Recommendation Evaluation Outputs — Not Software Test Results/`.
