import hashlib
import os
import secrets
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path

import bcrypt
import jwt
from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from sqlalchemy.orm import Session

import database
import models
import schemas

app = FastAPI(title="Osdag Secure Login System")
limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

SECRET_KEY = os.getenv("SECRET_KEY", "change-this-development-secret-key-at-least-32-bytes")
ALGORITHM = os.getenv("ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))
REFRESH_TOKEN_EXPIRE_DAYS = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "7"))
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", Path(__file__).parent / "uploaded_files"))
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login")

database.Base.metadata.create_all(bind=database.engine)


def get_db():
    db = database.SessionLocal()
    try:
        yield db
    finally:
        db.close()


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_access_token(user_id: int) -> str:
    expires = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    return jwt.encode({"sub": str(user_id), "exp": expires}, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    if db.query(models.RevokedToken).filter_by(token=token_digest(token)).first():
        raise HTTPException(status_code=401, detail="Could not validate credentials")
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = int(payload["sub"])
    except (jwt.PyJWTError, KeyError, TypeError, ValueError):
        raise HTTPException(status_code=401, detail="Could not validate credentials")
    user = db.query(models.User).filter_by(id=user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="Could not validate credentials")
    return user


@app.post("/register", response_model=schemas.UserResponse)
@limiter.limit("5/minute")
def register(request: Request, user: schemas.UserCreate, db: Session = Depends(get_db)):
    email = user.email.lower()
    if db.query(models.User).filter_by(email=email).first():
        raise HTTPException(status_code=400, detail="Email already registered")
    hashed = bcrypt.hashpw(user.password.encode(), bcrypt.gensalt()).decode()
    new_user = models.User(email=email, hashed_password=hashed)
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user


@app.post("/login", response_model=schemas.Token)
@limiter.limit("5/minute")
def login(request: Request, form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(models.User).filter_by(email=form_data.username.lower()).first()
    valid = user and bcrypt.checkpw(form_data.password.encode(), user.hashed_password.encode())
    if not valid:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    access_token = create_access_token(user.id)
    refresh_token = secrets.token_urlsafe(48)
    db.add(models.RefreshToken(token=refresh_token, user_id=user.id,
                               expires_at=datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)))
    db.commit()
    return {"token": access_token, "access_token": access_token, "refresh_token": refresh_token, "token_type": "bearer"}


@app.post("/refresh", response_model=schemas.Token)
@limiter.limit("10/minute")
def refresh_token(request: Request, body: schemas.RefreshTokenRequest, db: Session = Depends(get_db)):
    entry = db.query(models.RefreshToken).filter_by(token=body.refresh_token).first()
    now = datetime.now(timezone.utc)
    expires = entry.expires_at.replace(tzinfo=timezone.utc) if entry and entry.expires_at.tzinfo is None else entry.expires_at if entry else now
    if not entry or expires <= now:
        if entry:
            db.delete(entry)
            db.commit()
        raise HTTPException(status_code=401, detail="Invalid refresh token")
    user = db.query(models.User).filter_by(id=entry.user_id).first()
    db.delete(entry)
    new_refresh = secrets.token_urlsafe(48)
    db.add(models.RefreshToken(token=new_refresh, user_id=user.id,
                               expires_at=now + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)))
    db.commit()
    access = create_access_token(user.id)
    return {"token": access, "access_token": access, "refresh_token": new_refresh, "token_type": "bearer"}


@app.post("/logout")
def logout(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    if not db.query(models.RevokedToken).filter_by(token=token_digest(token)).first():
        db.add(models.RevokedToken(token=token_digest(token)))
        db.commit()
    return {"message": "Successfully logged out"}


@app.get("/me", response_model=schemas.UserResponse)
def get_me(current_user: models.User = Depends(get_current_user)):
    return current_user


@app.get("/files", response_model=list[schemas.FileResponse])
def get_user_files(current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(models.File).filter_by(owner_id=current_user.id).all()


def owned_file(file_id: int, current_user: models.User, db: Session):
    file = db.query(models.File).filter_by(id=file_id).first()
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    if file.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Access forbidden")
    return file


@app.get("/files/{file_id}", response_model=schemas.FileResponse)
def get_file(file_id: int, current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    return owned_file(file_id, current_user, db)


@app.get("/files/{file_id}/download")
def download_file(file_id: int, current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    record = owned_file(file_id, current_user, db)
    path = Path(record.filepath)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(path=path, filename=record.filename, media_type="application/octet-stream")


@app.post("/files/upload", response_model=schemas.FileResponse, status_code=201)
async def upload_file(file: UploadFile = File(...), current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    safe_name = Path(file.filename or "upload.bin").name
    stored_name = f"{current_user.id}_{secrets.token_hex(8)}_{safe_name}"
    path = UPLOAD_DIR / stored_name
    with path.open("wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    record = models.File(filename=safe_name, filepath=str(path), owner_id=current_user.id)
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


@app.get("/ping")
@limiter.limit("5/minute")
def ping(request: Request):
    return {"message": "pong"}
