"""
Server-side store scoping: managers must be restricted to their assigned
store on every store-scoped endpoint, and admins must be unrestricted.
This is the automated version of the manual curl checks used to verify
enforce_store_scope() when it was first added.
"""
import pytest


def test_unauthenticated_request_is_rejected(client):
    r = client.get("/forecast/1")
    assert r.status_code == 401


def test_admin_can_access_any_store(client, admin_headers):
    r = client.get("/forecast/1", headers=admin_headers)
    assert r.status_code == 200

    r = client.get("/forecast/7", headers=admin_headers)
    assert r.status_code == 200


def test_manager_can_access_own_store(client, manager_headers):
    r = client.get("/forecast/5", headers=manager_headers)
    assert r.status_code == 200
    assert r.json()["store_id"] == 5


def test_manager_is_blocked_from_other_store(client, manager_headers):
    r = client.get("/forecast/1", headers=manager_headers)
    assert r.status_code == 403


@pytest.mark.parametrize("path", [
    "/forecast/1",
    "/shap/local?store_id=1",
    "/metadata/dss-output?store_id=1",
])
def test_manager_is_blocked_on_every_scoped_endpoint(client, manager_headers, path):
    r = client.get(path, headers=manager_headers)
    assert r.status_code == 403


@pytest.mark.parametrize("path", [
    "/forecast/5",
    "/shap/local?store_id=5",
    "/metadata/dss-output?store_id=5",
])
def test_manager_is_allowed_on_every_scoped_endpoint_for_own_store(client, manager_headers, path):
    r = client.get(path, headers=manager_headers)
    assert r.status_code == 200
