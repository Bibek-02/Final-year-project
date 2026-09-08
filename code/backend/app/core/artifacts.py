import json
import joblib
import pandas as pd
from app.config import settings

ARTIFACT_DIR = settings.artifact_dir


class ArtifactStore:
    weekly_model          = None
    monthly_model         = None
    weekly_features       = None
    monthly_features      = None
    weekly_predictions    = None
    monthly_predictions   = None
    weekly_shap_global    = None
    monthly_shap_global   = None
    weekly_shap_local     = None
    monthly_shap_local    = None
    weekly_importance     = None
    monthly_importance    = None
    model_comparison      = None
    dss_output            = None
    model_metadata        = None


store = ArtifactStore()


def load_all_artifacts():
    print("Loading artefacts from:", ARTIFACT_DIR)

    store.weekly_model       = joblib.load(f"{ARTIFACT_DIR}/xgb_weekly_model.pkl")
    store.monthly_model      = joblib.load(f"{ARTIFACT_DIR}/xgb_monthly_model.pkl")
    store.weekly_features    = joblib.load(f"{ARTIFACT_DIR}/weekly_feature_columns.pkl")
    store.monthly_features   = joblib.load(f"{ARTIFACT_DIR}/monthly_feature_columns.pkl")

    store.weekly_predictions  = pd.read_csv(
        f"{ARTIFACT_DIR}/weekly_test_predictions.csv",
        parse_dates=["WeekStartDate"]
    )
    store.monthly_predictions = pd.read_csv(
        f"{ARTIFACT_DIR}/monthly_test_predictions.csv",
        parse_dates=["MonthStartDate"]
    )

    store.weekly_shap_global  = pd.read_csv(f"{ARTIFACT_DIR}/weekly_global_shap_values.csv")
    store.monthly_shap_global = pd.read_csv(f"{ARTIFACT_DIR}/monthly_global_shap_values.csv")

    store.weekly_shap_local   = pd.read_csv(f"{ARTIFACT_DIR}/weekly_local_shap_explanation.csv")
    store.monthly_shap_local  = pd.read_csv(f"{ARTIFACT_DIR}/monthly_local_shap_explanation.csv")

    store.weekly_importance   = pd.read_csv(f"{ARTIFACT_DIR}/xgb_weekly_feature_importance.csv")
    store.monthly_importance  = pd.read_csv(f"{ARTIFACT_DIR}/xgb_monthly_feature_importance.csv")

    store.model_comparison    = pd.read_csv(f"{ARTIFACT_DIR}/final_model_comparison_all_models.csv")
    store.dss_output          = pd.read_csv(f"{ARTIFACT_DIR}/sample_dss_forecast_output.csv")

    with open(f"{ARTIFACT_DIR}/model_metadata.json") as f:
        store.model_metadata = json.load(f)

    print("All artefacts loaded successfully.")
