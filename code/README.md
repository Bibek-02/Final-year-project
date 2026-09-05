# Rossmann DSS

An explainable, web-based decision support system for retail demand
forecasting, built around the Rossmann Store Sales dataset. Built for the
BSc thesis *"Evaluation of an Explainable Web-Based Decision Support System
Integrating Agentic AI for Retail Demand Forecasting: A Case Study Using the
Rossmann Store Sales Dataset."*

XGBoost forecasts and their SHAP-based explanations are precomputed
("artefact-first") and served through a role-scoped FastAPI backend to a
React dashboard. A Claude-powered agent turns the forecast + SHAP evidence
for a given store/period into staffing, stock, and promotion
recommendations.

## Architecture

```
React (CRA)  ──axios + JWT──▶  FastAPI  ──▶  ArtifactStore (in-memory pandas)
  6 pages                        6 routers        model_artifacts/*.csv, *.pkl
                                                    MongoDB (user accounts only)
                                                    Anthropic API (agent page only)
```

- **Backend** (`backend/app/`) — FastAPI. Loads all forecast/SHAP/metadata
  artefacts into memory once at startup; every request reads from that
  in-memory store. Auth is JWT-based; managers are scoped server-side to
  their assigned store (`app/core/dependencies.py::enforce_store_scope`),
  admins see everything. See [`backend/model_artifacts/ARTIFACTS.md`](backend/model_artifacts/ARTIFACTS.md)
  for what each data file is and which endpoint serves it.
- **Frontend** (`frontend/`) — Create React App + Tailwind + Recharts.
- **Database** — MongoDB, used only for user accounts (username, hashed
  password, role, assigned store). All forecast/SHAP/model data comes from
  the artefact files, not the database.
- **Agent** — `POST /agent/recommend` calls Claude (`claude-opus-5`) with
  the forecast and top SHAP features for a store/period and gets back a
  structured staffing/stock/promotions recommendation
  (`output_format=AgentOutput`, so the shape is guaranteed, not parsed).

## Prerequisites

- Python 3.11+ (developed against 3.13)
- Node.js 18+ / npm
- A MongoDB instance (local or Atlas) — only used for user accounts
- An Anthropic API key (for the AI Agent page)

## Setup

### Backend

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env        # then fill in JWT_SECRET, MONGO_URI, ANTHROPIC_API_KEY
python scripts/seed_admin.py    # creates the initial admin login (safe to re-run)
uvicorn app.main:app --reload
```

The API is now at `http://127.0.0.1:8000`, with interactive docs at
`http://127.0.0.1:8000/docs`.

Run the backend test suite with `pytest` (from `backend/`). It never touches
a real database or the live Anthropic API — user lookups are mocked with a
fixed set of fake users (`tests/conftest.py`), and the Claude client is
mocked in `tests/test_agent.py` — so it's fast, deterministic, and runnable
without any secrets configured. It does load the real `model_artifacts/`
data, since that's the thing worth testing against.

### Frontend

```bash
cd frontend
npm install
npm start
```

The app is now at `http://localhost:3000`. It must be opened at exactly that
origin — the backend's CORS policy (`app/main.py`) only allows
`http://localhost:3000`, so `127.0.0.1:3000` will be blocked by the browser.

### Logging in

`scripts/seed_admin.py` creates an admin account (`admin` / whatever you set
`ADMIN_PASSWORD` to, default `admin123` — change it after first login). Log
in as admin, then use the **Users** page to create manager accounts, each
scoped to one store via `assigned_store`.

## Roles

| Role | Can see | Enforced |
|---|---|---|
| `admin` | All stores, all pages, user management | — |
| `manager` | Only their `assigned_store`, no user management | Server-side, in every router (`enforce_store_scope`) — not just the disabled store selector in the UI |

## Project structure

```
backend/
├── app/
│   ├── main.py               # FastAPI app, CORS, router registration
│   ├── config.py             # pydantic-settings — single source of env-driven config
│   ├── core/
│   │   ├── artifacts.py      # Loads model_artifacts/ into memory at startup
│   │   ├── security.py       # Password hashing, JWT encode/decode, Mongo user CRUD
│   │   └── dependencies.py   # get_current_user, require_admin, enforce_store_scope
│   ├── schemas/               # Pydantic response models (also drives /docs)
│   ├── services/               # Business logic — forecast/shap/agent
│   │                            # (routers stay thin: parse params → call service → return)
│   └── routers/                # forecast, shap, models, metadata, agent, auth
├── scripts/seed_admin.py    # Bootstrap the first admin login
├── model_artifacts/         # See ARTIFACTS.md — precomputed forecasts, SHAP, models
└── requirements.txt

frontend/
└── src/
    ├── App.js                # Page routing (state-based, not URL-based)
    ├── api/client.js          # Axios instance, attaches JWT to every request
    ├── lib/featureLabels.js   # Shared plain-language feature name mapping
    ├── hooks/useApi.js        # Shared loading/error/fetch pattern used by every
    │                          # data-fetching page (except UserManagement, which
    │                          # refetches after create/delete, not just on mount)
    ├── components/            # Navbar, StoreSelector
    └── pages/                 # Grouped to mirror the thesis's own structure —
        ├── forecast/          #   Forecast:  Dashboard, ForecastChart
        ├── explain/           #   Explain:   Explanation, BusinessPanel
        ├── agent/             #   Decide:    Agent
        ├── compare/           #   Evidence:  ModelCompare
        ├── admin/             #   Admin:     UserManagement
        └── auth/              #   Login
```

## Known limitations

- Forecasts are replayed from a precomputed test set, not generated from
  live model inference — the trained `.pkl` models are loaded but not yet
  called by any endpoint. See the note in `ARTIFACTS.md`.
- Global SHAP values are computed over a 1,000-row sample of the test set,
  not the full set.
