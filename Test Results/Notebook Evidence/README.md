# Notebook Evidence

Original notebook, linked and not copied: [`Notebook/rossmann.ipynb`](../../Notebook/rossmann.ipynb)

The two kinds of evidence below are separate. Neither is a fresh execution log.

## 1. Assertion extraction (2026-10-07)

- **What happened:** the notebook's JSON was parsed and every `assert` statement was listed. **The notebook was not rerun.**
- **Result:** 9 assertions in code cells 14, 30 and 32. See `2026-10-07/notebook_assertions.txt`.
- **What it shows:** which assertions exist. It does not show that they passed.

## 2. Saved notebook outputs (run date: Not recorded)

These are outputs stored in the notebook from an earlier run, on a Python 3.12.7 kernel according to its metadata.

| Code cell | Assertions | Saved output |
|---|---|---|
| 14 | 2 | Printed dataset summary, including "Missing : 0 values". No explicit pass message |
| 30 | 3 | Printed split sizes and date ranges. No explicit pass message |
| 32 | 4 | Printed "feature dimension check passed" for weekly and monthly |

The notebook has no saved error outputs. This is consistent with the assertions having held in that run, but it is not an execution log.

## Status

| Item | Record |
|---|---|
| Passed, failed, skipped | Not recorded |
| Fresh execution log | None |
| Mocked dependencies | None recorded |
| Code version | The notebook file matches commit `5333a3a`, its last commit. The version it was run from: Not recorded |
| Later changes | No uncommitted changes to the notebook. Saved outputs may not reflect code changed elsewhere in the project |
