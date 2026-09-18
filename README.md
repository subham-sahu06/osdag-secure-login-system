# Osdag Secure Login System with User Details & File Access

This workspace contains two interchangeable implementations of the same API contract:

- `custom-backend/`: FastAPI, SQLAlchemy, PostgreSQL in deployment, SQLite by default for local tests.
- `appwrite-backend/`: Express bridge backed by Appwrite Auth, Databases, and Storage.
- `frontend/`: browser client with a Custom FastAPI/Appwrite toggle.
- `seed/`: repeatable fixture entry points for both backends.

## Quick start

### Custom backend

```bash
cd custom-backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp ../.env.example .env
alembic upgrade head
python ../seed/seed_custom.py
uvicorn main:app --reload --port 8000
```

Set `DATABASE_URL` to PostgreSQL for deployment. If it is omitted, local SQLite is used. Docker runs PostgreSQL and the API together:

```bash
cd custom-backend
docker compose up -d --build
```

### Appwrite backend

Create an Appwrite project and API key with Users, Databases, and Storage permissions, then configure:

```bash
cd appwrite-backend
cp .env.example .env
npm install
npm run setup
npm run seed
npm start
```

Set `APPWRITE_MODE=live` to fail fast when a real Appwrite service or cloud project is required. The default `APPWRITE_MODE=auto` retries the configured endpoint and falls back to a persistent local `.mock-appwrite.json` adapter when it cannot connect. Use `APPWRITE_MODE=mock` to force offline setup and seeding. Verify that fallback with `npm run verify:mock`. For a local Appwrite deployment, set `APPWRITE_ENDPOINT=http://localhost:8080/v1` (or another mapped port) and expose that port from the Appwrite container.

The setup script creates the database, file collection attributes, and private bucket. The seed creates `user1@test.com`, `user2@test.com`, and `user3@test.com`, each with one private file. Their default password is `Password123!` for Appwrite and `password123` for the custom fixtures.

### Frontend

Serve `frontend/` with any static server, for example:

```bash
python -m http.server 5500 --directory frontend
```

Open `http://localhost:5500` and choose either backend. The Appwrite bridge must allow the frontend origin using `CORS_ORIGIN`.

## API contract

Both implementations provide `POST /register`, `POST /login`, `POST /logout`, `GET /me`, `GET /files`, `GET /files/:id`, `GET /files/:id/download`, and authenticated `POST /files/upload`. Custom login uses OAuth2 form fields (`username`, `password`); Appwrite login uses JSON (`email`, `password`).

## Mandatory evaluation prompts

### 1. JWT versus session authentication

JWTs are self-contained and easy to verify across horizontally scaled services, but revocation is difficult and tokens can remain valid until expiry. Server sessions are simpler to revoke and keep less authorization state in the browser, but every request needs a session lookup and a shared session store for multiple instances.

The custom backend uses short-lived JWT access tokens plus rotating refresh tokens because that fits an independently scalable API. Logout is still genuinely server-side through durable token revocation. Appwrite uses opaque Appwrite session secrets, which are server-managed sessions and therefore naturally revocable.

### 2. Logout mechanics

Custom logout hashes the presented access token and stores the digest in the `revoked_tokens` table. Authentication checks that table before accepting a JWT, so a logged-out token fails immediately on every API instance that shares the database. Refresh tokens are one-time-use and deleted during rotation; logout can therefore not be bypassed by an old refresh token.

The Appwrite bridge calls `Account.deleteSession('current')`. Appwrite invalidates that session server-side; subsequent requests using its secret fail before profile or file access is attempted.

### 3. User data isolation

Custom `/files` queries always filter by `owner_id = current_user.id`. Single-file metadata and downloads first load the record, then return `403` when its owner differs. Uploads derive the owner from the authenticated token and generate a server-side storage name; clients cannot select an owner or path.

Appwrite documents store `ownerId`, have document permissions granted only to `Role.user(ownerId)`, and are queried with `Query.equal('ownerId', user.$id)`. The bridge repeats the owner check for single-document and download requests, while Storage files receive the same user-specific read permission. A second authenticated user therefore gets an explicit forbidden response and cannot read the first user's document or bytes.

### 4. Appwrite automatic versus manual configuration

Appwrite handles password hashing, account identity, session creation and invalidation, document authorization evaluation, storage authorization, file persistence, and API-level authentication. The project manually configures the Appwrite project, API key, database, collection attributes, bucket limits, allowed extensions, and per-user permissions in `setup-appwrite.js`.

The Express bridge is also manual: it translates the common API contract, attaches the bearer session to an Appwrite client, performs the explicit owner check, maps document metadata, proxies downloads, and applies login rate limiting. `seed-appwrite.js` is manual provisioning for reproducible evaluation fixtures.

### 5. Further improvements

Given more time I would add Redis-backed rate limiting and caching, refresh-token/device management for the Appwrite-facing client, malware scanning and content hashing for uploads, structured audit logs, stronger password policy and email verification, container images for the Appwrite bridge, CI security tests, and centralized observability. A production deployment would also use HTTPS, a secrets manager, PostgreSQL migrations in CI, and a shared revocation/cache store rather than local development defaults.

## Security checklist

- Passwords are bcrypt hashes in the custom database; Appwrite hashes them internally.
- Failed custom and Appwrite login responses are generic (`Invalid credentials`).
- Login routes are rate-limited at five attempts per minute per source address.
- Protected routes require a bearer token/session secret.
- File metadata and bytes are owner-scoped, not merely hidden in the UI.
- `.env` files, local databases, and uploads are excluded from source control.

## Tests

Run the custom tests without unrelated globally installed pytest plugins:

```bash
cd custom-backend
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 pytest -q
```

The Appwrite flow can be verified with the three seeded accounts and by using one account's file ID while authenticated as another; `/files/:id` and `/files/:id/download` must return `403`.
