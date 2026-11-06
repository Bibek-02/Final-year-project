# Backend Results

## Pytest results (2026-10-07)

| Item | Record |
|---|---|
| What was tested | Login and roles, store access rules, forecast and SHAP endpoints, store comparison, and the recommendation agent |
| Full suite | 74 passed, 0 failed, 0 skipped |
| Key tests | 5 passed, 0 failed, 0 skipped. These are part of the 74 and are not additional |
| Command | `python -m pytest -v --tb=short`, run from `code/backend/`, with JUnit output for the full suite |
| Environment | Windows 11, Python 3.13.4, pytest 9.1.1 (see `environment.txt`) |
| Code version | Commit `1ef298c` plus uncommitted changes, not a clean commit. Most of those changes were committed afterwards in `5333a3a` |

**Important warnings (2):** a Starlette/httpx deprecation warning, and an XGBoost warning about loading a pickled model.

**Mocked:**
- MongoDB user functions, replaced with in-memory fake users
- Claude `messages.parse`
- Selected in-memory artifact tables, in edge-case tests only

**Real:** the files in `model_artifacts/`, password hashing, JWT handling, and FastAPI through its test client.

**Not recorded:** network activity and whether `.env` was used during the run. A real `MongoClient` object is still created when the app is imported.

**Later changes:** `git status` shows no uncommitted changes under `code/backend/`, and no later commit changes it. The results still describe the 7 October run, so a rerun on the final commit would give a clean code version.

**Files:** `2026-10-07/` holds `backend_pytest.txt`, `backend_junit.xml`, `backend_key_tests.txt`, `environment.txt` and `SUMMARY.md`.

**Inconsistencies in the original records (left uncorrected):**
- `environment.txt` says "20 modified, 6 untracked", but its own list has 21 and 10.
- `environment.txt` also says three untracked paths were not present at test time, yet lists them in the status for that time.
- `SUMMARY.md` was last modified after the run, so the raw logs are the primary record.

## API capture (2026-11-05)

Open `2026-11-05 API responses/API Responses.html` to see each real request and response. The full responses are in `responses/`.

| Item | Record |
|---|---|
| What this is | A manual capture of 19 read-only requests, not a test suite. It is not added to the 74 |
| Result | 19 of 19 status codes were as expected. Response data was not checked |
| Code version | Commit `111b46d`, with no uncommitted changes under `code/backend/` (see `run_info.txt`) |
| Real | Local FastAPI server, model artifacts, and user records read from the configured MongoDB database |
| Mocked | Nothing |

**Not called:**
- `POST /agent/recommend`, because it makes a paid Claude call
- `POST /auth/register` and `DELETE /auth/users/{username}`, because they write to the database
- `GET /auth/users`, because it lists all accounts

**Not captured:** a real manager 403 store-block response, because the account used is an admin. The pytest suite covers this rule using fake users.

Access tokens and passwords are shown as `[hidden]`.
