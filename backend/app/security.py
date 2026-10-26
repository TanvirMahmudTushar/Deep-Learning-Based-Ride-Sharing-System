from datetime import timedelta
from typing import Annotated

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db, utcnow
from app.models import Profile, Rider

_bearer = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), hashed.encode())
    except ValueError:
        return False


def create_token(profile: Profile) -> str:
    payload = {"sub": profile.id, "role": profile.role, "exp": utcnow() + timedelta(minutes=settings.jwt_expire_minutes)}
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def profile_from_token(db: Session, token: str | None) -> Profile | None:
    if not token:
        return None
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None
    return db.get(Profile, payload.get("sub"))


def current_user(
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    db: Annotated[Session, Depends(get_db)],
) -> Profile:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    try:
        payload = jwt.decode(creds.credentials, settings.jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")
    profile = db.get(Profile, payload.get("sub"))
    if profile is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account not found")
    return profile


def require_role(*roles: str):
    def dep(user: Annotated[Profile, Depends(current_user)]) -> Profile:
        if user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"This action needs the {' or '.join(roles)} role")
        return user

    return dep


def current_rider(
    user: Annotated[Profile, Depends(require_role("rider"))],
    db: Annotated[Session, Depends(get_db)],
) -> Rider:
    rider = user.rider
    if rider is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Rider profile not found")
    return rider


DB = Annotated[Session, Depends(get_db)]
CurrentUser = Annotated[Profile, Depends(current_user)]
Passenger = Annotated[Profile, Depends(require_role("user"))]
Admin = Annotated[Profile, Depends(require_role("admin"))]
CurrentRider = Annotated[Rider, Depends(current_rider)]
