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
running at `http://127.0.0.1:8000` (see `backend/README` setup steps in the
root README).

## Scripts

- `npm start` — development server with hot reload
- `npm run build` — production build to `build/`
- `npm test` — CRA test runner. Tests live in `src/__tests__/`
  (`Navbar.test.jsx`, `StoreSelector.test.jsx`), covering the same
  RBAC behaviour the backend enforces server-side: the Users nav link is
  hidden from non-admins, and a manager's store dropdown is locked to
  their assigned store. No backend or network calls needed — `api/client`
  is mocked.
