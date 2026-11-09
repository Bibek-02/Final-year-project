# Rossmann DSS — Frontend

React (Create React App) frontend for the Rossmann Explainable DSS. See the
[project root README](../README.md) for architecture, setup instructions,
and the full project structure.

## Quick start

```bash
npm install
npm start
```

Runs at `http://localhost:3000` — must be opened at exactly that origin, not
`127.0.0.1:3000` (see the root README's CORS note). Requires the backend
running at `http://127.0.0.1:8000` (see the backend setup steps in the
root README).

## Scripts

- `npm start` — development server with hot reload
- `npm run build` — production build to `build/`
- `npm test` — CRA test runner. Tests live in `src/__tests__/`, one suite
  per page or component (9 suites: Agent, Dashboard, Explanation,
  ForecastChart, Login, ModelCompare, Sidebar, StoreComparison,
  StoreSelector). They include the role checks the backend also enforces
  server-side: the Users link is hidden from non-admins, and a manager's
  store dropdown is locked to their assigned store. No backend or network
  calls needed — `api/client` is mocked. For a single non-watch run, use
  the command in the root README's Testing section.
