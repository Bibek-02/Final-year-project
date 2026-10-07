"""
Shape/contract checks against the real precomputed artefacts in
model_artifacts/. response_model already guarantees the wire shape server
side (a malformed response would 500, not silently pass) — these tests
exist to catch future regressions, not to re-derive the guarantee.
"""


def test_stores_list_includes_known_store(client, admin_headers):
    r = client.get("/forecast/stores/list", headers=admin_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["forecast_type"] == "weekly"
    assert 1 in body["store_ids"]
    assert body["store_count"] == len(body["store_ids"])


def test_forecast_normalises_fields_regardless_of_granularity(client, admin_headers):
    weekly = client.get("/forecast/1?forecast_type=weekly", headers=admin_headers).json()
    monthly = client.get("/forecast/1?forecast_type=monthly", headers=admin_headers).json()

    for body in (weekly, monthly):
        assert body["record_count"] == len(body["forecasts"])
        assert body["record_count"] > 0
        for row in body["forecasts"]:
            assert set(row.keys()) == {"period", "actual_sales", "prediction"}


def test_forecast_unknown_store_is_404(client, admin_headers):
    r = client.get("/forecast/999999", headers=admin_headers)
    assert r.status_code == 404


def test_global_shap_returns_ranked_features(client, admin_headers):
    r = client.get("/shap/global?forecast_type=weekly&top_n=5", headers=admin_headers)
    assert r.status_code == 200
    features = r.json()["features"]
    assert len(features) == 5
    # Wire keys are Title-Case aliases (Field(alias=...)) — this is the
    # existing contract the frontend already reads (row['Mean_SHAP'] etc.),
    # preserved deliberately when these response schemas were added.
    values = [f["Mean_SHAP"] for f in features]
    assert values == sorted(values, reverse=True)


def test_local_shap_matches_requested_store(client, admin_headers):
    r = client.get("/shap/local?forecast_type=weekly&store_id=1", headers=admin_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["store_id"] == 1
    assert body["record_count"] > 0
    assert all(row["Store"] == 1 for row in body["explanation"])


def test_global_shap_includes_readable_feature(client, admin_headers):
    r = client.get("/shap/global?forecast_type=weekly&top_n=15", headers=admin_headers)
    assert r.status_code == 200
    features = r.json()["features"]
    assert all(f["Readable Feature"] for f in features)
    promo = next(f for f in features if f["Feature"] == "PromoDays")
    assert promo["Readable Feature"] == "promotion activity"


def test_local_shap_includes_readable_feature(client, admin_headers):
    r = client.get("/shap/local?forecast_type=weekly&store_id=1", headers=admin_headers)
    assert r.status_code == 200
    explanation = r.json()["explanation"]
    assert all(row["Readable Feature"] for row in explanation)
    promo = next(row for row in explanation if row["Feature"] == "PromoDays")
    assert promo["Readable Feature"] == "promotion activity"


def test_readable_feature_can_equal_raw_feature_for_unmapped_columns(client, admin_headers):
    """
    Some engineered columns (e.g. one-hot dummies, raw calendar counters) are
    not humanised in the offline pipeline, so the artifact's Readable Feature
    equals the raw Feature verbatim for them. The frontend's label fallback
    depends on this exact contract, so it's locked in here.
    """
    r = client.get("/shap/global?forecast_type=weekly&top_n=45", headers=admin_headers)
    assert r.status_code == 200
    features = r.json()["features"]
    store_type_a = next(f for f in features if f["Feature"] == "StoreType_a")
    assert store_type_a["Readable Feature"] == "StoreType_a"


def test_feature_importance_is_ranked(client, admin_headers):
    r = client.get("/shap/importance?forecast_type=weekly&top_n=5", headers=admin_headers)
    assert r.status_code == 200
    importance = r.json()["importance"]
    values = [row["Importance"] for row in importance]
    assert values == sorted(values, reverse=True)


def test_model_comparison_includes_champion_model(client, admin_headers):
    r = client.get("/models/best?forecast_type=weekly", headers=admin_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["best_model"] == "XGBoost"

    r = client.get("/models/compare", headers=admin_headers)
    assert r.status_code == 200
    models = {row["Model"] for row in r.json()["comparison"]}
    assert "XGBoost" in models


def test_dss_output_and_shap_agree_on_period(client, admin_headers):
    """
    Regression test for the period-mismatch bug fixed earlier: dss-output's
    default period and shap/local's default period must be the same period
    for the same store/forecast_type, since the business panel shows both
    together as one explanation.
    """
    dss = client.get(
        "/metadata/dss-output?forecast_type=weekly&store_id=1", headers=admin_headers
    ).json()
    shap = client.get(
        f"/shap/local?forecast_type=weekly&store_id=1&period={dss['period']}",
        headers=admin_headers,
    ).json()
    assert shap["period"] == dss["period"]


def test_feature_list_has_expected_count(client, admin_headers):
    r = client.get("/metadata/features?forecast_type=weekly", headers=admin_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["feature_count"] == len(body["features"])
    assert body["feature_count"] > 0
