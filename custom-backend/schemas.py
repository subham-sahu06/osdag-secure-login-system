from pydantic import BaseModel, ConfigDict
from typing import Optional

class UserBase(BaseModel):
    email: str

class UserCreate(UserBase):
    password: str

class UserResponse(UserBase):
    id: int
    model_config = ConfigDict(from_attributes=True)

class FileBase(BaseModel):
    filename: str
    filepath: str

class FileResponse(FileBase):
    id: int
    owner_id: int
    model_config = ConfigDict(from_attributes=True)

class Token(BaseModel):
    token: Optional[str] = None
    access_token: str
    refresh_token: str
    token_type: str

class RefreshTokenRequest(BaseModel):
    refresh_token: str

class TokenData(BaseModel):
    email: Optional[str] = None