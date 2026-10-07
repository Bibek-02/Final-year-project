"""
Login, token validation, role gating (admin-only endpoints), and
register/delete — backed by the per-test mutable fake user store in
conftest.py's patch_user_lookup fixture.
"""
from datetime import datetime, timedelta, timezone
from jose import jwt

from app.core.security import JWT_SECRET, JWT_ALGORITHM
from tests.conftest import ADMIN_PASSWORD, MANAGER_PASSWORD


def test_login_success_returns_token(client):
    r = client.post("/auth/login", data={"username": "test_admin", "password": ADMIN_PASSWORD})
    assert r.status_code == 200
    body = r.json()
    assert body["token_type"] == "bearer"
    assert body["role"] == "admin"
    assert body["access_token"]


def test_login_wrong_password_is_rejected(client):
    r = client.post("/auth/login", data={"username": "test_admin", "password": "wrong"})
    assert r.status_code == 401


def test_login_unknown_user_is_rejected(client):
    r = client.post("/auth/login", data={"username": "nobody", "password": "whatever"})
    assert r.status_code == 401


def test_me_returns_current_user(client, manager_headers):
    r = client.get("/auth/me", headers=manager_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["username"] == "test_manager5"
    assert body["role"] == "manager"
    assert body["assigned_store"] == 5


def test_admin_only_endpoint_rejects_manager(client, manager_headers):
    r = client.get("/auth/users", headers=manager_headers)
    assert r.status_code == 403


def test_admin_only_endpoint_allows_admin(client, admin_headers):
    r = client.get("/auth/users", headers=admin_headers)
    assert r.status_code == 200
    usernames = [u["username"] for u in r.json()["users"]]
    assert "test_admin" in usernames
    assert "test_manager5" in usernames


def test_expired_token_is_rejected(client):
    expired_payload = {
        "sub": "test_admin",
        "role": "admin",
        "assigned_store": None,
        "exp": datetime.now(timezone.utc) - timedelta(minutes=1),
    }
    expired_token = jwt.encode(expired_payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

    r = client.get("/auth/me", headers={"Authorization": f"Bearer {expired_token}"})
    assert r.status_code == 401


def test_garbage_token_is_rejected(client):
    r = client.get("/auth/me", headers={"Authorization": "Bearer not-a-real-token"})
    assert r.status_code == 401


def test_users_list_excludes_password_hash(client, admin_headers):
    r = client.get("/auth/users", headers=admin_headers)
    assert r.status_code == 200
    for user in r.json()["users"]:
        assert "password" not in user


def test_register_creates_manager(client, admin_headers):
    r = client.post(
        "/auth/register",
        json={"username": "store9_manager", "password": "somepass123", "role": "manager", "assigned_store": 9},
        headers=admin_headers,
    )
    assert r.status_code == 200

    listed = client.get("/auth/users", headers=admin_headers).json()["users"]
    created = next(u for u in listed if u["username"] == "store9_manager")
    assert created["role"] == "manager"
    assert created["assigned_store"] == 9
    assert "password" not in created

    # The password was actually hashed and stored correctly, not just
    # accepted — prove it round-trips through a real login.
    login = client.post("/auth/login", data={"username": "store9_manager", "password": "somepass123"})
    assert login.status_code == 200
    assert login.json()["role"] == "manager"


def test_register_duplicate_username_is_rejected(client, admin_headers):
    r = client.post(
        "/auth/register",
        json={"username": "test_admin", "password": "whatever123", "role": "manager", "assigned_store": 1},
        headers=admin_headers,
    )
    assert r.status_code == 400


def test_register_manager_without_store_is_rejected(client, admin_headers):
    r = client.post(
        "/auth/register",
        json={"username": "no_store_manager", "password": "somepass123", "role": "manager"},
        headers=admin_headers,
    )
    assert r.status_code == 400


def test_register_requires_admin(client, manager_headers):
    r = client.post(
        "/auth/register",
        json={"username": "sneaky_manager", "password": "somepass123", "role": "manager", "assigned_store": 2},
        headers=manager_headers,
    )
    assert r.status_code == 403


def test_delete_default_admin_is_protected(client, admin_headers):
    r = client.delete("/auth/users/admin", headers=admin_headers)
    assert r.status_code == 400


def test_delete_non_manager_account_is_protected(client, admin_headers):
    # FR-05 says admins can delete *manager* accounts — an admin-role
    # account under a different username than the literal "admin" should
    # still be refused, not just the one hardcoded username.
    client.post(
        "/auth/register",
        json={"username": "second_admin", "password": "somepass123", "role": "admin"},
        headers=admin_headers,
    )
    r = client.delete("/auth/users/second_admin", headers=admin_headers)
    assert r.status_code == 400


def test_delete_user_removes_manager(client, admin_headers):
    client.post(
        "/auth/register",
        json={"username": "temp_manager", "password": "somepass123", "role": "manager", "assigned_store": 3},
        headers=admin_headers,
    )
    r = client.delete("/auth/users/temp_manager", headers=admin_headers)
    assert r.status_code == 200

    listed = client.get("/auth/users", headers=admin_headers).json()["users"]
    assert "temp_manager" not in [u["username"] for u in listed]


def test_delete_unknown_user_is_404(client, admin_headers):
    r = client.delete("/auth/users/does_not_exist", headers=admin_headers)
    assert r.status_code == 404


def test_delete_requires_admin(client, manager_headers):
    r = client.delete("/auth/users/test_manager5", headers=manager_headers)
    assert r.status_code == 403
