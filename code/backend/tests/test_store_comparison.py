"""
GET /forecast/stores/comparison — admin-only cross-store aggregation.
Shape/contract checks against the real precomputed artefacts (same rationale
as test_forecast.py), plus monkeypatched edge cases that don't naturally
occur in the clean real data (zero-actual percentage, duplicate rows,
non-finite values) using the same shared-singleton monkeypatch approach as
conftest.py's patch_user_lookup.
"""
import pandas as pd
import pytest
from app.core.artifacts import store

# Verified directly against backend/model_artifacts/weekly_test_predictions.csv.
INCOMPLETE_WEEKLY_STORES = {183, 292, 876, 909, 971}


def test_unauthenticated_is_rejected(client):
    r = client.get("/forecast/stores/comparison")
    assert r.status_code == 401


def test_manager_is_rejected(client, manager_headers):
    r = client.get("/forecast/stores/comparison", headers=manager_headers)
    assert r.status_code == 403


def test_admin_can_access(client, admin_headers):
    r = client.get("/forecast/stores/comparison", headers=admin_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["store_count"] == len(body["stores"])


def test_default_range_is_full_available_range(client, admin_headers):
    r = client.get("/forecast/stores/comparison?forecast_type=weekly", headers=admin_headers)
    body = r.json()
    assert body["start_period"] == body["available_periods"][0]
    assert body["end_period"] == body["available_periods"][-1]
    assert body["selected_periods"] == body["available_periods"]
    assert body["period_count"] == len(body["available_periods"])


def test_weekly_default_range_has_1115_stores_and_13_periods(client, admin_headers):
    r = client.get("/forecast/stores/comparison?forecast_type=weekly", headers=admin_headers)
    body = r.json()
    assert body["store_count"] == 1115
    assert body["period_count"] == 13


def test_weekly_default_range_flags_five_incomplete_stores(client, admin_headers):
    r = client.get("/forecast/stores/comparison?forecast_type=weekly", headers=admin_headers)
    rows = r.json()["stores"]
    incomplete = {row["store_id"] for row in rows if not row["is_complete"]}
    assert incomplete == INCOMPLETE_WEEKLY_STORES

    complete_row = next(row for row in rows if row["store_id"] == 1)
    assert complete_row["periods_covered"] == complete_row["periods_expected"] == 13
    assert complete_row["is_complete"] is True


def test_monthly_default_range_has_no_incomplete_stores(client, admin_headers):
    r = client.get("/forecast/stores/comparison?forecast_type=monthly", headers=admin_headers)
    body = r.json()
    assert body["store_count"] == 1115
    assert body["period_count"] == 3
    assert all(row["is_complete"] for row in body["stores"])


def test_difference_matches_predicted_minus_actual(client, admin_headers):
    r = client.get("/forecast/stores/comparison?forecast_type=weekly", headers=admin_headers)
    row = next(row for row in r.json()["stores"] if row["store_id"] == 1)
    assert row["difference"] == pytest.approx(row["total_predicted"] - row["total_actual"], abs=0.01)
    assert row["absolute_difference"] == pytest.approx(abs(row["difference"]), abs=0.01)


def test_comparison_totals_match_per_store_forecast_endpoint(client, admin_headers):
    forecast = client.get("/forecast/1?forecast_type=weekly", headers=admin_headers).json()
    comparison = client.get(
        "/forecast/stores/comparison?forecast_type=weekly", headers=admin_headers
    ).json()
    row = next(r for r in comparison["stores"] if r["store_id"] == 1)

    assert row["total_predicted"] == pytest.approx(
        sum(f["prediction"] for f in forecast["forecasts"]), abs=0.02
    )
    assert row["total_actual"] == pytest.approx(
        sum(f["actual_sales"] for f in forecast["forecasts"]), abs=0.02
    )


def test_narrower_period_range_reduces_expected_coverage(client, admin_headers):
    full = client.get("/forecast/stores/comparison?forecast_type=weekly", headers=admin_headers).json()
    first_two = full["available_periods"][:2]

    r = client.get(
        f"/forecast/stores/comparison?forecast_type=weekly"
        f"&start_period={first_two[0]}&end_period={first_two[1]}",
        headers=admin_headers,
    )
    body = r.json()
    assert body["period_count"] == 2
    assert body["selected_periods"] == first_two
    assert all(row["periods_expected"] == 2 for row in body["stores"])


def test_unknown_period_is_rejected(client, admin_headers):
    r = client.get(
        "/forecast/stores/comparison?forecast_type=weekly&start_period=1999-01-01",
        headers=admin_headers,
    )
    assert r.status_code == 400


def test_start_after_end_is_rejected(client, admin_headers):
    r = client.get(
        "/forecast/stores/comparison?forecast_type=weekly&start_period=2015-07-27&end_period=2015-05-04",
        headers=admin_headers,
    )
    assert r.status_code == 400


def test_cross_granularity_period_is_rejected(client, admin_headers):
    # "2015-05-01" is a valid MONTHLY period but not a valid WEEKLY one
    # (weekly periods start at 2015-05-04) — must not silently fall back.
    r = client.get(
        "/forecast/stores/comparison?forecast_type=weekly&start_period=2015-05-01",
        headers=admin_headers,
    )
    assert r.status_code == 400


def test_zero_actual_sales_yields_null_percentage(monkeypatch, client, admin_headers):
    synthetic = pd.DataFrame({
        "Store"          : [9001, 9001],
        "Period"         : ["2015-05-04", "2015-05-11"],
        "Forecast Type"  : ["Weekly", "Weekly"],
        "Actual Sales"   : [0, 0],
        "Predicted Sales": [100.0, 50.0],
    })
    monkeypatch.setattr(store, "weekly_predictions", synthetic)

    r = client.get("/forecast/stores/comparison?forecast_type=weekly", headers=admin_headers)
    assert r.status_code == 200
    row = r.json()["stores"][0]
    assert row["total_actual"] == 0
    assert row["difference_pct"] is None


def test_duplicate_store_period_is_rejected_as_server_error(monkeypatch, client, admin_headers):
    synthetic = pd.DataFrame({
        "Store"          : [1, 1],
        "Period"         : ["2015-05-04", "2015-05-04"],
        "Forecast Type"  : ["Weekly", "Weekly"],
        "Actual Sales"   : [100, 110],
        "Predicted Sales": [95.0, 105.0],
    })
    monkeypatch.setattr(store, "weekly_predictions", synthetic)

    r = client.get("/forecast/stores/comparison?forecast_type=weekly", headers=admin_headers)
    assert r.status_code == 500


def test_non_finite_value_is_rejected_as_server_error(monkeypatch, client, admin_headers):
    synthetic = pd.DataFrame({
        "Store"          : [1],
        "Period"         : ["2015-05-04"],
        "Forecast Type"  : ["Weekly"],
        "Actual Sales"   : [100],
        "Predicted Sales": [float("inf")],
    })
    monkeypatch.setattr(store, "weekly_predictions", synthetic)

    r = client.get("/forecast/stores/comparison?forecast_type=weekly", headers=admin_headers)
    assert r.status_code == 500
