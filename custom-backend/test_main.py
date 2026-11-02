from starlette.testclient import TestClient
from main import app

client = TestClient(app)

def test_full_auth_and_files_flow():
    # 1. Register test user
    reg_res = client.post("/register", json={"email": "pytest_flow@example.com", "password": "password123"})
    assert reg_res.status_code in [200, 400]

    # 2. Login test
    login_res = client.post("/login", data={"username": "pytest_flow@example.com", "password": "password123"})
    assert login_res.status_code == 200
    token = login_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # 3. Get profile (/me)
    me_res = client.get("/me", headers=headers)
    assert me_res.status_code == 200
    assert me_res.json()["email"] == "pytest_flow@example.com"

    # 4. Get files (/files)
    files_res = client.get("/files", headers=headers)
    assert files_res.status_code == 200

    # 5. Logout (/logout)
    logout_res = client.post("/logout", headers=headers)
    assert logout_res.status_code == 200

    # 6. Verify token invalidated after logout
    protected_res = client.get("/me", headers=headers)
    assert protected_res.status_code == 401


def test_refresh_token_flow():
    # 1. Register & Login
    client.post("/register", json={"email": "refresh_test@example.com", "password": "password123"})
    login_res = client.post("/login", data={"username": "refresh_test@example.com", "password": "password123"})
    assert login_res.status_code == 200
    
    refresh_token = login_res.json()["refresh_token"]

    # 2. Call /refresh endpoint
    refresh_res = client.post("/refresh", json={"refresh_token": refresh_token})
    assert refresh_res.status_code == 200
    assert "access_token" in refresh_res.json()
    assert "refresh_token" in refresh_res.json()