import os
from pathlib import Path

from database import SessionLocal, engine, Base
import models
import bcrypt

def seed_data():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    users_data = [
        {"email": "user1@test.com", "password": "password123"},
        {"email": "user2@test.com", "password": "password123"},
        {"email": "user3@test.com", "password": "password123"},
    ]

    for u in users_data:
        existing = db.query(models.User).filter(models.User.email == u["email"]).first()
        if not existing:
            hashed = bcrypt.hashpw(u["password"].encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
            user = models.User(email=u["email"], hashed_password=hashed)
            db.add(user)
            db.commit()
            db.refresh(user)

            # Sample file attached to each test user
            sample_file = models.File(
                filename=f"user_{user.id}_document.pdf",
                filepath=f"/uploads/user_{user.id}_document.pdf",
                owner_id=user.id
            )
            db.add(sample_file)
            db.commit()
            sample_path = Path(os.getenv("UPLOAD_DIR", "uploaded_files")) / sample_file.filename
            sample_path.parent.mkdir(parents=True, exist_ok=True)
            sample_path.write_text(f"Private fixture for {user.email}\n", encoding="utf-8")
        elif not existing.files:
            db.add(models.File(
                filename=f"user_{existing.id}_document.pdf",
                filepath=f"{os.getenv('UPLOAD_DIR', 'uploaded_files')}/user_{existing.id}_document.pdf",
                owner_id=existing.id,
            ))
            db.commit()

    print("✅ Seed successful: 3 test users and sample files created!")
    db.close()

if __name__ == "__main__":
    seed_data()