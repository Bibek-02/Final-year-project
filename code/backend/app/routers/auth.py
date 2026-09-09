from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import OAuth2PasswordRequestForm
from app.core.security import (
    verify_password, create_token,
    get_user, get_all_users, create_user, delete_user
)
from app.core.dependencies import get_current_user, require_admin
from app.schemas.auth import RegisterRequest, TokenResponse

router = APIRouter()


@router.post("/login", response_model=TokenResponse)
def login(form: OAuth2PasswordRequestForm = Depends()):
    user = get_user(form.username)
    if not user or not verify_password(form.password, user["password"]):
        raise HTTPException(status_code=401, detail="Invalid username or password.")

    token = create_token({
        "sub"           : user["username"],
        "role"          : user["role"],
        "assigned_store": user.get("assigned_store"),
    })
    return {
        "access_token"  : token,
        "token_type"    : "bearer",
        "username"      : user["username"],
        "role"          : user["role"],
        "assigned_store": user.get("assigned_store"),
    }


@router.get("/me")
def get_me(current_user=Depends(get_current_user)):
    return {
        "username"      : current_user["username"],
        "role"          : current_user["role"],
        "assigned_store": current_user.get("assigned_store"),
    }


@router.get("/users")
def list_users(admin=Depends(require_admin)):
    users = get_all_users()
    for u in users:
        u["_id"] = str(u["_id"])
    return {"users": users}


@router.post("/register")
def register(req: RegisterRequest, admin=Depends(require_admin)):
    if req.role == "manager" and req.assigned_store is None:
        raise HTTPException(
            status_code=400,
            detail="assigned_store is required for manager role."
        )
    result = create_user(req.username, req.password, req.role, req.assigned_store)
    if not result:
        raise HTTPException(status_code=400, detail="Username already exists.")
    return {"message": f"User '{req.username}' created successfully."}


@router.delete("/users/{username}")
def remove_user(username: str, admin=Depends(require_admin)):
    if username == "admin":
        raise HTTPException(status_code=400, detail="Cannot delete admin user.")
    result = delete_user(username)
    if not result:
        raise HTTPException(status_code=404, detail="User not found.")
    return {"message": f"User '{username}' deleted successfully."}
