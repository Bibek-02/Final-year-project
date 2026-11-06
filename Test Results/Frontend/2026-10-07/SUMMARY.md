
## Backend (pytest)

Command:
```
python -m pytest -v --tb=short --junitxml=../evidence/run_20261007_1125/backend_junit.xml
```
Run from `backend/`. Full console output: `backend_pytest.txt`. JUnit XML: `backend_junit.xml`.

**Totals:** 74 passed, 0 failed, 0 skipped, 2 warnings, in 9.72s.

### Key requirement tests
Command:
```
python -m pytest -v --tb=short -k "test_agent_prompt_excludes_actual_sales_and_future_data or test_manager_is_blocked_from_other_store or test_expired_token_is_rejected or test_agent_forecast_shap_period_mismatch_returns_clear_error or test_dss_output_and_shap_agree_on_period"
```
Output saved to `backend_key_tests.txt`. All 5 requested test names exist (collected 74 items / 69 deselected / 5 selected) and all 5 PASSED:

- `tests/test_agent.py::test_agent_prompt_excludes_actual_sales_and_future_data` — PASSED
- `tests/test_agent.py::test_agent_forecast_shap_period_mismatch_returns_clear_error` — PASSED
- `tests/test_auth.py::test_expired_token_is_rejected` — PASSED
- `tests/test_forecast.py::test_dss_output_and_shap_agree_on_period` — PASSED
- `tests/test_store_scope.py::test_manager_is_blocked_from_other_store` — PASSED

Result: `5 passed, 69 deselected, 2 warnings in 3.17s`.

## Frontend (Jest via react-scripts)

Command:
```
CI=true npx react-scripts test --watchAll=false --verbose
```
Run from `frontend/`. Full console output: `frontend_jest.txt`.

**Totals:** Test Suites: 9 passed, 9 total. Tests: 290 passed, 290 total. Snapshots: 0 total. Time: 26.815s (estimated 27s).

**act() warnings:** 3 occurrences of "not wrapped in act(" found in the output (not fixed, per instructions).

## Failures

None. Backend: 0 failed. Frontend: 0 failed.

## Notebook (not executed)

`notebook_assertions.txt` lists every `assert` statement found by static parse of `../Model traning/rossmann.ipynb` (no execution): 9 assert statements across 3 code cells (cell 14, 30, 32).

## Exact commands used

```
git rev-parse HEAD
git rev-parse --abbrev-ref HEAD
git status --short
python --version
node --version
npm --version
python -m pip show pytest fastapi pandas numpy scikit-learn xgboost shap anthropic   (run from backend/)
npm list react recharts axios   (run from frontend/)

cd backend
python -m pytest -v --tb=short --junitxml=../evidence/run_20261007_1125/backend_junit.xml

python -m pytest -v --tb=short -k "test_agent_prompt_excludes_actual_sales_and_future_data or test_manager_is_blocked_from_other_store or test_expired_token_is_rejected or test_agent_forecast_shap_period_mismatch_returns_clear_error or test_dss_output_and_shap_agree_on_period"

cd ../frontend
set CI=true
npx react-scripts test --watchAll=false --verbose
```

Notebook assertions were extracted via a Python script that parsed the notebook JSON (`json.load`) and scanned each code cell's source for lines containing `assert` — the notebook itself was never executed.
