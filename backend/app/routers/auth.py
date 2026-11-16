from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy import select

from app.brta import normalize_plate
from app.models import Profile, Rider, Vehicle
from app.realtime import ADMINS, emit
from app.schemas import AuthOut, LoginIn, PasswordChangeIn, ProfileOut, ProfileUpdateIn, RegisterIn
from app.security import DB, CurrentUser, account_is_suspended, create_token, hash_password, verify_password
from app.services import login_throttle

router = APIRouter(prefix="/api/auth", tags=["auth"])


def profile_out(p: Profile) -> ProfileOut:
    return ProfileOut(
        id=p.id,
        full_name=p.full_name,
        email=p.email,
        phone=p.phone,
        role=p.role,
        approval_status=p.approval_status,
        avatar_url=f"/api/documents/{p.avatar_doc_id}/file" if p.avatar_doc_id else None,
    )


@router.post("/register", response_model=AuthOut, status_code=status.HTTP_201_CREATED)
def register(body: RegisterIn, db: DB):
    email = body.email.strip().lower()
    if db.scalar(select(Profile.id).where(Profile.email == email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists")

    vehicle_fields = (body.license_no, body.vehicle_type, body.plate_no, body.vehicle_model)
    has_any_vehicle = any(vehicle_fields)
    if body.role == "rider" and has_any_vehicle and not all(vehicle_fields):
        raise HTTPException(422, "Riders must provide licence, vehicle type, plate number and model")

    profile = Profile(
        full_name=body.full_name.strip(),
        email=email,
        phone=body.phone.strip(),
        password_hash=hash_password(body.password),
        role=body.role,
        # Support agents get access straight away; an admin can still remove it later.
        approval_status="approved" if body.role == "support" else None,
    )
    db.add(profile)
    db.flush()
    if body.role == "support":
        emit(db, ADMINS, "support.changed", notify=("New support agent", f"{profile.full_name} signed up as a support agent."))
    if body.role == "rider":
        # No admin verification: riders can go online as soon as they have a vehicle.
        rider = Rider(profile_id=profile.id, license_no=(body.license_no or "").strip(), status="verified")
        db.add(rider)
        db.flush()
        if all(vehicle_fields):
            db.add(
                Vehicle(
                    rider_id=rider.id,
                    vehicle_type=body.vehicle_type,
                    plate_no=normalize_plate(body.plate_no, body.vehicle_type),
                    model=body.vehicle_model.strip(),
                    verified=True,
                )
            )
    db.commit()
    return AuthOut(token=create_token(profile), profile=profile_out(profile))


@router.post("/login", response_model=AuthOut)
def login(body: LoginIn, request: Request, db: DB):
    email = body.email.strip().lower()
    ip = request.client.host if request.client else "unknown"
    wait = login_throttle.retry_after(email, ip)
    if wait:
        minutes = max(1, round(wait / 60))
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            f"Too many failed attempts. Try again in about {minutes} minute{'s' if minutes != 1 else ''}.",
            headers={"Retry-After": str(wait)},
        )
    profile = db.scalar(select(Profile).where(Profile.email == email))
    if profile is None or not verify_password(body.password, profile.password_hash):
        login_throttle.record_failure(email, ip)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong email or password")
    if account_is_suspended(profile):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Account suspended. Contact support.")
    login_throttle.clear(email, ip)
    return AuthOut(token=create_token(profile), profile=profile_out(profile))


@router.get("/me", response_model=ProfileOut)
def me(user: CurrentUser):
    return profile_out(user)


@router.patch("/me", response_model=ProfileOut)
def update_me(body: ProfileUpdateIn, user: CurrentUser, db: DB):
    user.full_name = body.full_name.strip()
    user.phone = body.phone.strip()
    db.commit()
    return profile_out(user)


@router.post("/password", response_model=AuthOut)
def change_password(body: PasswordChangeIn, user: CurrentUser, db: DB):
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Current password is wrong")
    if verify_password(body.new_password, user.password_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Choose a password different from your current one")
    user.password_hash = hash_password(body.new_password)
    db.commit()
    # Older tokens stop working now; this one keeps the current device logged in.
    return AuthOut(token=create_token(user), profile=profile_out(user))
