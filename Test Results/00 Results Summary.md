# Test Results Summary

Start here. Paths are relative to the project root. To see where the test code is and how to run it, read `Testing Guide.md`.

| Component | Run date | Passed | Failed | Skipped | Main limitation | Evidence path |
|---|---|---|---|---|---|---|
| Backend full suite | 2026-10-07 | 74 | 0 | 0 | Database user functions and Claude client are mocked | `Test Results/Backend/2026-10-07/backend_pytest.txt` |
| Backend key tests (part of the 74, not additional) | 2026-10-07 | 5 | 0 | 0 | Same as the full suite | `Test Results/Backend/2026-10-07/backend_key_tests.txt` |
| Frontend | 2026-10-07 | 290 | 0 | 0 | API client is mocked; 4 November frontend edits are not covered | `Test Results/Frontend/2026-10-07/frontend_jest.txt` |
| Evaluation harness | 2026-10-16 | 24 | 0 | 0 | Claude is stubbed; checks harness code, not recommendation quality; code version not recorded | `Test Results/Evaluation Harness/2026-10-16/evaluation_harness_pytest.txt` |
| Notebook assertions | Not recorded | Not recorded | Not recorded | Not recorded | 9 assertions were listed on 2026-10-07 without rerunning the notebook | `Test Results/Notebook Evidence/2026-10-07/notebook_assertions.txt` |
| Backend API capture (not a test suite) | 2026-11-05 | Not applicable | Not applicable | Not applicable | 19 of 19 status codes were as expected; response data was not checked, and no real manager 403 was captured | `Test Results/Backend/2026-11-05 API responses/API Responses.html` |

The easiest pages to read:

- `Test Results/Backend/2026-11-05 API responses/API Responses.html` shows each real API request and response.
- `Test Results/Frontend/2026-10-07/Test Results.html` shows a PASS row for each of the 290 frontend tests.

## How to read these results

- These are historical results. Each one describes the code at its run date and may not cover later changes.
- Totals come from execution logs, not from counting test functions.
- The API capture is separate from the 74 backend tests and is not added to them.
- Recommendation evaluation outputs are not software test results. They are in `Test Results/Evaluation Harness/Recommendation Evaluation Outputs — Not Software Test Results/`.

## Missing evidence

- Frontend tests have not been run since the 4 November edits.
- Harness run: code version, working tree state and package versions are not recorded.
- Frontend run: Jest and react-scripts versions are not recorded.
- Notebook: there is no fresh execution log, and the date of the saved outputs is not recorded.
- Live recommendation generation: no console log exists.
- API capture: no real manager 403 response, because the account used is an admin.
- Cache files suggest other pytest runs on 2026-10-07, but no logs exist, so no results are claimed for them.

## Recommended fresh runs

1. Frontend tests, after committing the 4 November edits.
2. Backend and harness tests on that same commit, saving the commit hash and package versions with the logs.
