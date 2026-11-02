# Osdag Secure Login System & File Access

This repository contains a dual-implementation backend for the Osdag Secure Login System task, featuring a custom FastAPI + PostgreSQL backend and a managed Appwrite backend setup.

## 1. Authentication Architecture Decisions
- **JWT vs. Session-Based Auth:** JWT was selected for statelessness and seamless Docker horizontal scaling.
- **Server-Side Logout:** Handled by an in-memory blacklisted token registry upon `/logout` requests.

## 2. Security & Data Isolation
- **Password Protection:** Passwords are hashed using bcrypt before database persistence.
- **Generic Auth Errors:** Failed login attempts return generic error messages.
- **Rate Limiting:** Enforced via `slowapi` to prevent brute-force attacks.
- **Data Isolation:** All protected routes filter queries by `user_id == current_user.id`.

## 3. Appwrite vs. Custom Backend
- **Appwrite:** Handled OAuth2/JWT token issuance, user session management, database rules, and file storage bucket policies natively.
- **Custom Backend:** Built with FastAPI + SQLAlchemy, providing full control over custom migration scripts (Alembic) and rate-limiting logic.

## 4. Setup & Running Instructions
```bash
docker-compose up -d --build
alembic upgrade head
python seed.py
```
