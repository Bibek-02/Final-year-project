from fastapi import HTTPException, Depends
from fastapi.security import OAuth2PasswordBearer
from app.core.security import decode_token, get_user

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


#  Dependency: get current user from token
def get_current_user(token: str = Depends(oauth2_scheme)):
    try:
        payload  = decode_token(token)
        username = payload.get("sub")
        if not username:
            raise HTTPException(status_code=401, detail="Invalid token.")
        user = get_user(username)
        if not user:
            raise HTTPException(status_code=401, detail="User not found.")
        return user
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token.")


#  Dependency: admin only
def require_admin(current_user=Depends(get_current_user)):
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin access required.")
    return current_user


#  Authorization: restrict managers to their assigned store
def enforce_store_scope(current_user: dict, store_id: int):
    """
    Admins may access any store. Managers may only access their assigned store.
    Call this after resolving store_id in any endpoint that reads store-specific data.
    """
    if current_user["role"] == "manager" and current_user.get("assigned_store") != store_id:
        raise HTTPException(
            status_code=403,
            detail=f"You do not have access to Store {store_id}."
        )
