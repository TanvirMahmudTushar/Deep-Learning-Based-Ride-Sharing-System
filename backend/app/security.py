import hashlib
import hmac
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


def _password_stamp(profile: Profile) -> str:
    """Changes whenever the password does, so changing it signs out every older token."""
    return hmac.new(settings.jwt_secret.encode(), profile.password_hash.encode(), hashlib.sha256).hexdigest()[:16]


def create_token(profile: Profile) -> str:
    payload = {
        "sub": profile.id,
        "role": profile.role,
        "pwd": _password_stamp(profile),
        "exp": utcnow() + timedelta(minutes=settings.jwt_expire_minutes),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def profile_from_token(db: Session, token: str | None) -> Profile | None:
    if not token:
        return None
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None
    profile = db.get(Profile, payload.get("sub"))
    if profile is None or not hmac.compare_digest(str(payload.get("pwd")), _password_stamp(profile)):
        return None
    return profile


def current_user(
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    db: Annotated[Session, Depends(get_db)],
) -> Profile:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    profile = profile_from_token(db, creds.credentials)
    if profile is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")
    return profile


def require_role(*roles: str):
    def dep(user: Annotated[Profile, Depends(current_user)]) -> Profile:
        if user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"This action needs the {' or '.join(roles)} role")
        return user

    return dep


def require_staff(user: Annotated[Profile, Depends(current_user)]) -> Profile:
    """Admins, and support agents an admin has approved. Checked on every request, so removing access is immediate."""
    if user.role == "admin" or (user.role == "support" and user.approval_status == "approved"):
        return user
    if user.role == "support":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Your support account is waiting for admin approval")
    raise HTTPException(status.HTTP_403_FORBIDDEN, "This action needs the admin or support role")


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
Staff = Annotated[Profile, Depends(require_staff)]
CurrentRider = Annotated[Rider, Depends(current_rider)]
