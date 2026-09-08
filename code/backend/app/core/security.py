from datetime import datetime, timedelta, timezone
from jose import jwt
from passlib.context import CryptContext
from pymongo import MongoClient
from app.config import settings

pwd_context        = CryptContext(schemes=["sha256_crypt"], deprecated="auto")
JWT_SECRET         = settings.jwt_secret
JWT_ALGORITHM      = settings.jwt_algorithm
JWT_EXPIRE_MINUTES = settings.jwt_expire_minutes
MONGO_URI          = settings.mongo_uri
MONGO_DB           = settings.mongo_db

mongo_client = MongoClient(MONGO_URI)
db           = mongo_client[MONGO_DB]
users_col    = db["users"]


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_token(data: dict) -> str:
    payload = data.copy()
    payload["exp"] = datetime.now(timezone.utc) + timedelta(minutes=JWT_EXPIRE_MINUTES)
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])


def get_user(username: str):
    return users_col.find_one({"username": username})


def get_all_users():
    return list(users_col.find({}, {"password": 0}))


def create_user(username: str, password: str,
                role: str = "manager", assigned_store: int = None):
    if get_user(username):
        return None
    users_col.insert_one({
        "username"      : username,
        "password"      : hash_password(password),
        "role"          : role,
        "assigned_store": assigned_store,
    })
    return True


def delete_user(username: str) -> bool:
    result = users_col.delete_one({"username": username})
    return result.deleted_count > 0
