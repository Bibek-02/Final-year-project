from pydantic import BaseModel
from typing import Optional


class RegisterRequest(BaseModel):
    username      : str
    password      : str
    role          : str = "manager"
    assigned_store: Optional[int] = None


class TokenResponse(BaseModel):
    access_token  : str
    token_type    : str
    username      : str
    role          : str
    assigned_store: Optional[int] = None
