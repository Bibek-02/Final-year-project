# Explainable Sales Forecasting with AI-Generated Retail Recommendations

Source code for the BSc Computer Science final-year project *"Explainable Sales Forecasting with AI-Generated Retail Recommendations: A Rossmann Case Study"* (De Montfort University, CTEC3451).

This is a web-based decision support prototype. XGBoost forecasts weekly and monthly store sales, and SHAP explains each forecast. Claude (Anthropic API) turns the forecast and its SHAP evidence into staffing, stock and promotion recommendations. Forecasts and explanations are computed in advance by the notebook and served by a FastAPI backend to a React frontend.

**Deployment:** the application is not deployed. It runs locally (see below).

## Folder structure

| Folder | Contents |
|---|---|
| `Notebook/rossmann.ipynb` | Data preparation, feature engineering, model comparison (moving average, Random Forest, XGBoost) and SHAP analysis |
| `code/backend/` | FastAPI backend, saved model outputs (`model_artifacts/`), admin seed script and pytest tests |
| `code/frontend/` | React frontend and Jest tests |
| `code/evaluation/rubric/` | Recommendation evaluation: case selection, rubric anchors, generated outputs and scores |
| `Test Results/` | Recorded test runs and environment details (start with `00 Results Summary.md`) |
| `Testing Guide.md` | How to re-run all test suites |

## Requirements

- Python 3.11 or later (tested with 3.13)
- Node.js 18 or later with npm (tested with Node 22)
- MongoDB, local or Atlas (stores user accounts only)
- An Anthropic API key (needed only for the AI recommendation page)

## How to install and run

### 1. Backend

```bash
cd code/backend
pip install -r requirements.txt
cp .env.example .env        # Windows: copy .env.example .env
```

Open `.env` and set `MONGO_URI`, `JWT_SECRET`, `ANTHROPIC_API_KEY` and `ADMIN_PASSWORD`. The defaults in `.env.example` are placeholders for local testing only.

```bash
python scripts/seed_admin.py     # creates the admin account in MongoDB
uvicorn app.main:app --reload
```

The API runs at http://127.0.0.1:8000 (interactive docs at http://127.0.0.1:8000/docs).

### 2. Frontend

In a second terminal:

```bash
cd code/frontend
npm install
npm start
```

Open http://localhost:3000 and log in as `admin` with the password set in `.env`. Manager accounts, each limited to one store, can be created on the Users page.

## Database

MongoDB holds only user accounts (username, hashed password, role and assigned store). `code/backend/scripts/seed_admin.py` is the database setup script. All forecast, SHAP and model data is read from the files in `code/backend/model_artifacts/`, so no data import is needed to run the application.

## Data

The application runs from the saved outputs in `code/backend/model_artifacts/`. To re-run the notebook, download `train.csv` and `store.csv` from the Kaggle Rossmann Store Sales competition (https://www.kaggle.com/c/rossmann-store-sales) and place them in `Notebook/data/`. The raw data is not included; it is available from Kaggle after accepting the competition rules.

## Tests

| Suite | Run from | Command |
|---|---|---|
| Backend (pytest) | `code/backend` | `python -m pytest -v` |
| Frontend (Jest) | `code/frontend` | `npx react-scripts test --watchAll=false` |
| Evaluation harness | `code/evaluation/rubric` | `python -m pytest tests/ -v` |

The tests mock the database and the Claude API, so they need no accounts or API key. More detail is in `code/README.md` and `Testing Guide.md`.


