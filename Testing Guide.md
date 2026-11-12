# Testing Guide

Where the tests are, how to run them, and where to find the results. All paths are relative to the project root. For the totals, read `Test Results/00 Results Summary.md`.

| Suite | Test code | Results |
|---|---|---|
| Backend | `code/backend/tests/` | `Test Results/Backend/` |
| Frontend | `code/frontend/src/__tests__/` | `Test Results/Frontend/` |
| Evaluation harness | `code/evaluation/rubric/tests/` | `Test Results/Evaluation Harness/` |
| Notebook assertions | `Notebook/rossmann.ipynb` (no separate test suite) | `Test Results/Notebook Evidence/` |

## How to run each suite

These commands were not run while preparing this guide. Fresh results may differ from the recorded ones.

### Backend

```powershell
cd code/backend
pip install -r requirements.txt
python -m pytest -v
```

The project README says this suite needs no secrets, because user lookups and the Claude client are mocked.

### Frontend

```powershell
cd code/frontend
npm install
$env:CI='true'; npx react-scripts test --watchAll=false --verbose
```

This is the recorded test command, written for PowerShell.

### Evaluation harness

```powershell
cd code/evaluation/rubric
pip install -r ../../backend/requirements.txt
python -m pytest tests/ -v
```

### Notebook

There is no test command for the notebook. Rerunning it would overwrite its saved outputs, so it is not treated as a test suite.

### Viewing API responses in the running app

The API capture needs a backend with configuration in `code/backend/.env` (see `code/backend/.env.example`) and a valid account.

```powershell
cd code/backend
uvicorn app.main:app
```

The saved responses can be read without running anything: `Test Results/Backend/2026-11-05 API responses/API Responses.html`.

### Commands that are not tests

- `code/evaluation/rubric/generate.py` without `--dry-run` makes paid Claude API calls.
- `code/backend/scripts/seed_admin.py` writes to the configured database.

## Paths for thesis Section 4.8 and Appendix A.2

| Evidence | Path |
|---|---|
| Results summary | `Test Results/00 Results Summary.md` |
| Backend full suite log | `Test Results/Backend/2026-10-07/backend_pytest.txt` |
| Backend JUnit results | `Test Results/Backend/2026-10-07/backend_junit.xml` |
| Backend key tests log | `Test Results/Backend/2026-10-07/backend_key_tests.txt` |
| Backend API responses | `Test Results/Backend/2026-11-05 API responses/API Responses.html` |
| Frontend log | `Test Results/Frontend/2026-10-07/frontend_jest.txt` |
| Frontend PASS list | `Test Results/Frontend/2026-10-07/Test Results.html` |
| Evaluation harness log | `Test Results/Evaluation Harness/2026-10-16/evaluation_harness_pytest.txt` |
| Notebook assertion list | `Test Results/Notebook Evidence/2026-10-07/notebook_assertions.txt` |
| Original notebook | `Notebook/rossmann.ipynb` |
| Recommendation evaluation report (not a software test) | `Test Results/Evaluation Harness/Recommendation Evaluation Outputs — Not Software Test Results/Real outputs/analysis_report.md` |

Cite these as historical results. Each one describes the code at its run date. The 5 backend key tests are part of the 74 and should not be added to it.
