from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.models import Profile, Rider, Vehicle
from app.schemas import AuthOut, LoginIn, PasswordChangeIn, ProfileOut, ProfileUpdateIn, RegisterIn
from app.security import DB, CurrentUser, create_token, hash_password, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])


def profile_out(p: Profile) -> ProfileOut:
    return ProfileOut(id=p.id, full_name=p.full_name, email=p.email, phone=p.phone, role=p.role)


@router.post("/register", response_model=AuthOut, status_code=status.HTTP_201_CREATED)
def register(body: RegisterIn, db: DB):
    email = body.email.strip().lower()
    if db.scalar(select(Profile.id).where(Profile.email == email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists")
    if body.role == "rider" and not (body.license_no and body.vehicle_type and body.plate_no and body.vehicle_model):
        raise HTTPException(422, "Riders must provide licence, vehicle type, plate number and model")

    profile = Profile(
        full_name=body.full_name.strip(),
        email=email,
        phone=body.phone.strip(),
        password_hash=hash_password(body.password),
        role=body.role,
    )
    db.add(profile)
    db.flush()
    if body.role == "rider":
        rider = Rider(profile_id=profile.id, license_no=body.license_no.strip(), status="pending")
        db.add(rider)
        db.flush()
        db.add(Vehicle(rider_id=rider.id, vehicle_type=body.vehicle_type, plate_no=body.plate_no.strip().upper(), model=body.vehicle_model.strip()))
    db.commit()
    return AuthOut(token=create_token(profile), profile=profile_out(profile))


@router.post("/login", response_model=AuthOut)
def login(body: LoginIn, db: DB):
    profile = db.scalar(select(Profile).where(Profile.email == body.email.strip().lower()))
    if profile is None or not verify_password(body.password, profile.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong email or password")
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


@router.post("/password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(body: PasswordChangeIn, user: CurrentUser, db: DB):
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Current password is wrong")
    user.password_hash = hash_password(body.new_password)
    db.commit()
