# Verification Evidence

Original records from the test runs, kept exactly as they were produced. Each folder is one verification session, named `run_<date>_<time>`.

For a readable version with summaries and Postman-style result pages, see [`../../Test Results/`](../../Test%20Results/), starting with `00 Results Summary.md`.

## Runs

### `run_20261007_1125/` (2026-10-07)

| File | What it is | Result |
|---|---|---|
| `backend_pytest.txt` | Full backend pytest log | 74 passed, 0 failed, 0 skipped |
| `backend_junit.xml` | The same backend run in JUnit XML format | 74 tests, 0 failures, 0 errors |
| `backend_key_tests.txt` | 5 selected key requirement tests | 5 passed. These are part of the 74, not additional |
| `frontend_jest.txt` | Full frontend Jest log | 290 passed, 0 failed, 0 skipped (9 suites) |
| `notebook_assertions.txt` | The 9 `assert` statements in `Model traning/rossmann.ipynb`, listed by reading the notebook file | Not a test result: the notebook was not rerun |
| `environment.txt` | Git commit, git status, and Python, Node and package versions at the time of the run | — |
| `SUMMARY.md` | Written summary of the commands and totals | — |

### `run_20261016_1751/` (2026-10-16)

| File | What it is | Result |
|---|---|---|
| `evaluation_harness_pytest.txt` | Evaluation harness pytest log | 24 passed, 0 failed, 0 skipped |
| `SUMMARY.md` | Written summary of the command and totals | — |

## Reading these records

- **The logs are the primary record.** Both `SUMMARY.md` files were written after their runs.
- **These are historical results.** They describe the code at each run date.
- **Later frontend changes are untested.** The frontend edits committed in `0028b28` have not been tested since.
- **Mocked dependencies:**
  - The backend tests mock database user lookups and the Claude client.
  - The frontend tests mock the API client.
  - The evaluation harness tests replace Claude with a dry-run stub.
- **Code version:**
  - The 7 October runs used commit `1ef298c` plus uncommitted changes (see `environment.txt`).
  - The code version for the 16 October run was not recorded.

## Adding a new run

Create a new `run_<date>_<time>/` folder. Save the full console output, plus the commit hash and package versions. Don't edit earlier runs.
