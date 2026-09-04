# Model artefacts

This directory is the backend's data source: `core/data_loader.py` loads every
file here into memory once at startup (`load_all_artifacts()`), and every
router reads from that in-memory `store`, never from disk directly.

These files are outputs of the offline model-training pipeline (data
preparation, feature engineering, model training, and SHAP computation) —
that pipeline is not part of this repository. Regenerating any file below
means re-running the corresponding step of that pipeline against the
Rossmann Store Sales dataset.

## Loaded and served (used by at least one endpoint)

| File | Size | Rows | Loaded as | Used by |
|---|---|---|---|---|
| `xgb_weekly_model.pkl` | 1.9 MB | — | `store.weekly_model` | Loaded but not yet invoked — see note below |
| `xgb_monthly_model.pkl` | 648 KB | — | `store.monthly_model` | Loaded but not yet invoked — see note below |
| `weekly_feature_columns.pkl` | 4 KB | — | `store.weekly_features` | `GET /metadata/features` |
| `monthly_feature_columns.pkl` | 4 KB | — | `store.monthly_features` | `GET /metadata/features` |
| `weekly_test_predictions.csv` | 4.0 MB | 14,487 | `store.weekly_predictions` | `GET /forecast/{store_id}`, `GET /forecast/stores/list` |
| `monthly_test_predictions.csv` | 848 KB | 3,345 | `store.monthly_predictions` | `GET /forecast/{store_id}`, `GET /forecast/stores/list` |
| `weekly_global_shap_values.csv` | 452 KB | 1,000 | `store.weekly_shap_global` | `GET /shap/global` |
| `monthly_global_shap_values.csv` | 400 KB | 1,000 | `store.monthly_shap_global` | `GET /shap/global` |
| `weekly_local_shap_explanation.csv` | 42 MB | 651,915 | `store.weekly_shap_local` | `GET /shap/local` |
| `monthly_local_shap_explanation.csv` | 8.7 MB | 137,145 | `store.monthly_shap_local` | `GET /shap/local` |
| `xgb_weekly_feature_importance.csv` | 4 KB | 41 | `store.weekly_importance` | `GET /shap/importance` |
| `xgb_monthly_feature_importance.csv` | 4 KB | 41 | `store.monthly_importance` | `GET /shap/importance` |
| `final_model_comparison_all_models.csv` | 1 KB | 6 | `store.model_comparison` | `GET /models/compare`, `GET /models/best` |
| `sample_dss_forecast_output.csv` | 8.6 MB | 17,832 | `store.dss_output` | `GET /metadata/dss-output`, `POST /agent/recommend` |
| `model_metadata.json` | 4 KB | — | `store.model_metadata` | `GET /metadata` |

**Note on `xgb_weekly_model.pkl` / `xgb_monthly_model.pkl`:** these are the
actual trained XGBoost models, loaded at startup but never called. Every
forecast/SHAP endpoint replays precomputed values from the CSVs above rather
than running live inference — the system is deliberately "artefact-first"
(see `model_metadata.json`). Adding a `POST /forecast/predict` endpoint that
calls `.predict()` on these models would close that gap; until then, treat
this as a stated architectural choice, not an oversight.

## Present but not currently loaded

| File | Size | Rows | Status |
|---|---|---|---|
| `rossmann_weekly_model_features.csv` | 23 MB | 87,828 | Full weekly training feature matrix (pre train/test split). Training input, not a deployment artefact — never read by `data_loader.py`. |
| `rossmann_monthly_model_features.csv` | 4.7 MB | 20,085 | Same, monthly granularity. |
| `rf_weekly_feature_importance.csv` | 4 KB | 45 | Random Forest feature importance (weekly). Computed for the RF vs XGBoost comparison but not surfaced by any endpoint — the frontend's Explanation page only shows XGBoost's SHAP/importance. |
| `rf_monthly_feature_importance.csv` | 4 KB | 41 | Same, monthly granularity. |

The four files above account for ~28 MB of this directory's ~95 MB total and
have no effect on the running application. They're kept for reference /
reproducibility, not because the backend depends on them.

## Column reference

- **Forecast CSVs** (`*_test_predictions.csv`): `Store`, `{Week,Month}StartDate`,
  `{Weekly,Monthly}Sales` (actual), engineered features, `Prediction`
  (XGBoost's predicted value). Served to the API normalised as
  `period` / `actual_sales` / `prediction` regardless of granularity.
- **Global SHAP CSVs**: one row per sampled test instance, one column per
  feature — the *raw* per-instance SHAP values. The API aggregates these to
  `mean(|SHAP|)` per feature at request time; it does not store a
  pre-aggregated table.
- **Local SHAP CSVs**: long format — `Store`, `Period`, `Feature`,
  `Feature Value`, `SHAP Value`, `Effect`. One row per (store, period,
  feature) triple.
- **`sample_dss_forecast_output.csv`**: the business-facing layer — `Store`,
  `Period`, `Forecast Type`, `Predicted Sales`, `Actual Sales`,
  `Important Positive Factors`, `Important Negative Factors`,
  `Business Message` (a pre-written plain-language paragraph). This is what
  the Business Panel and AI Agent pages read from.
