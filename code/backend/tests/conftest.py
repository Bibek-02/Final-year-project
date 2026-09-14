"""
Shared fixtures for the backend test suite.

User lookups/writes are monkeypatched to a fake in-memory user store instead
of a real MongoDB — this suite never needs a live database connection, which
keeps it fast, deterministic, and runnable without any secrets configured
(and safe: without this, register/delete tests would otherwise hit whatever
real MongoDB URI is configured in .env). Forecast/SHAP/model data is NOT
mocked: it comes from the real files in model_artifacts/, loaded once via
the app's normal startup lifespan, since that data is a protected research
artefact and testing against it directly is the point.
"""
import copy
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.core.security import hash_password, create_token

ADMIN_PASSWORD   = "adminpass123"
MANAGER_PASSWORD = "managerpass123"

FAKE_USERS = {
    "test_admin": {
        "_id"           : "fake_id_admin",
        "username"      : "test_admin",
        "password"      : hash_password(ADMIN_PASSWORD),
        "role"          : "admin",
        "assigned_store": None,
    },
    "test_manager5": {
        "_id"           : "fake_id_manager5",
        "username"      : "test_manager5",
        "password"      : hash_password(MANAGER_PASSWORD),
        "role"          : "manager",
        "assigned_store": 5,
    },
}


@pytest.fixture(autouse=True)
def patch_user_lookup(monkeypatch):
    """
    Fresh mutable copy of FAKE_USERS for every test, so register/delete
    tests can add and remove users without leaking state into other tests.
    get_user/get_all_users/create_user/delete_user are imported by
    reference into the modules that call them — patch each call site, not
    the original definitions in core.security.
    """
    store = copy.deepcopy(FAKE_USERS)

    def fake_get_user(username):
        return store.get(username)

    def fake_get_all_users():
        return [{k: v for k, v in u.items() if k != "password"} for u in store.values()]

    def fake_create_user(username, password, role="manager", assigned_store=None):
        if username in store:
            return None
        store[username] = {
            "_id"           : f"fake_id_{username}",
            "username"      : username,
            "password"      : hash_password(password),
            "role"          : role,
            "assigned_store": assigned_store,
        }
        return True

    def fake_delete_user(username):
        return store.pop(username, None) is not None

    monkeypatch.setattr("app.core.dependencies.get_user", fake_get_user)
    monkeypatch.setattr("app.routers.auth.get_user", fake_get_user)
    monkeypatch.setattr("app.routers.auth.get_all_users", fake_get_all_users)
    monkeypatch.setattr("app.routers.auth.create_user", fake_create_user)
    monkeypatch.setattr("app.routers.auth.delete_user", fake_delete_user)


@pytest.fixture(scope="session")
def client():
    # Session-scoped: model_artifacts/ is ~95MB and loading it is the
    # dominant cost of the suite. The app object is shared across all
    # tests; per-test isolation comes from patch_user_lookup (below),
    # which is function-scoped and safe to re-apply on a shared app.
    with TestClient(app) as c:
        yield c


@pytest.fixture
def admin_token():
    return create_token({"sub": "test_admin", "role": "admin", "assigned_store": None})


@pytest.fixture
def manager_token():
    return create_token({"sub": "test_manager5", "role": "manager", "assigned_store": 5})


@pytest.fixture
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture
def manager_headers(manager_token):
    return {"Authorization": f"Bearer {manager_token}"}
