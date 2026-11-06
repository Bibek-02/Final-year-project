# Frontend Results

Open `2026-10-07/Test Results.html` for a PASS row per test. The page is built only from the log `2026-10-07/frontend_jest.txt`.

| Item | Record |
|---|---|
| What was tested | Sidebar, store selector, login, Dashboard, Forecast Chart, Explanation, Model Compare, Store Comparison and AI Recommendations components |
| Run date | 2026-10-07 |
| Totals | 290 passed, 0 failed, 0 skipped (9 suites) |
| Command | `npx react-scripts test --watchAll=false --verbose`, run from `code/frontend/` with `CI=true` |
| Environment | Windows 11, Node 22.16.0, npm 10.9.2, React 19.2.6 (see `environment.txt`) |
| Code version | Commit `1ef298c` plus uncommitted changes, not a clean commit. Most of those changes were committed afterwards in `5333a3a` |

**Not recorded:** Jest and react-scripts resolved versions, and the exact shell used to set `CI=true`.

**Important warnings in the log:**
- 123 Recharts width/height warnings, because jsdom has no real layout
- 3 `act()` warnings for `StoreCombobox`
- 2 "SHAP reconciliation check failed" console errors
- 1 jsdom "navigation not implemented" error
- A message that a worker process was force exited
- A PowerShell `NativeCommandError` wrapper around the first PASS line

None of these changed the recorded totals. `SUMMARY.md` mentions only the `act()` warnings, so this list is fuller.

**Mocked:**
- `../api/client` in 8 of the 9 suites (the Sidebar suite does not mock it)
- `URL.createObjectURL` and `URL.revokeObjectURL` in the Agent suite

Tests run in jsdom, with no real backend or browser. The log contains no real API responses. For those, see `../Backend/2026-11-05 API responses/API Responses.html`, which labels each endpoint with the frontend page that uses it. That capture does not test the pages themselves.

**Later changes: these results do not cover the current frontend.** Five files were edited on 4 November and are uncommitted: `ModelCompare.test.jsx`, `ModelCompare.jsx`, `App.js`, `Sidebar.jsx` and `index.css`. One test was removed from `ModelCompare.test.jsx`, so 290 describes the 7 October run only. A fresh run is recommended.

The log includes short source excerpts in console stack traces. It is kept unchanged so that it matches the original.
