"""Offline check of the Microsoft login callback path (no network, no server).

The authorization-code exchange is the only step that must talk to Microsoft;
everything after it — state verification, ID-token validation, find-or-create
by email, token issuance — is exercised here against the real DB with the
exchange monkeypatched to return a crafted id_token.

Usage (needs the DB, same as the backend):

    cd trans-once && python3 tests/microsoft_flow.py
"""
from __future__ import annotations

import base64
import json
import os
import sys
import time
import uuid
from unittest.mock import patch

from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

load_dotenv()

import db  # noqa: E402
import platform_settings  # noqa: E402
import routers.auth as auth_router  # noqa: E402
import security  # noqa: E402

CLIENT_ID = "ms-flow-test-client"
TID = "11111111-1111-1111-1111-111111111111"
EMAIL = f"ms-flow-{uuid.uuid4().hex[:8]}@transonce.local"

passed = 0
failed: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    global passed
    if condition:
        passed += 1
        print(f"  ✓ {name}")
    else:
        failed.append(name)
        print(f"  ✗ {name}{(' — ' + detail) if detail else ''}")


def _b64e(obj: dict) -> str:
    return base64.urlsafe_b64encode(json.dumps(obj).encode()).rstrip(b"=").decode()


def _id_token(claims: dict) -> str:
    return f"{_b64e({'alg': 'HS256', 'typ': 'JWT'})}.{_b64e(claims)}.sig"


def main() -> int:
    # Isolate this run's platform settings; restore whatever was there.
    original = platform_settings.get_auth_settings()
    ms_email = EMAIL.lower()
    try:
        platform_settings.save_auth_settings({
            "microsoft": {
                "enabled": True, "tenantId": "common",
                "clientId": CLIENT_ID, "clientSecret": "test-secret",
            },
        })

        nonce = "nonce-flow-1"
        state = security.create_signed_value(
            "oauth-state",
            {"nonce": nonce, "redirect_uri": "http://localhost:3002/login/microsoft"},
            ttl_seconds=600,
        )
        claims = {
            "aud": CLIENT_ID,
            "iss": f"https://login.microsoftonline.com/{TID}/v2.0",
            "tid": TID,
            "exp": int(time.time()) + 600,
            "nonce": nonce,
            "email": ms_email,
            "name": "微软流程测试",
        }

        with patch.object(auth_router.microsoft_client, "exchange_code",
                          return_value={"id_token": _id_token(claims)}):
            res = auth_router.microsoft_callback({"code": "fake-code", "state": state})
        check("first microsoft login issues a token", bool(res.get("token")))
        check("auto-registered with display name",
              (res.get("user") or {}).get("name") == "微软流程测试")
        check("user serialized as microsoft provider",
              (res.get("user") or {}).get("authProvider") == "microsoft")

        row = db.fetch_one("SELECT * FROM users WHERE lower(email)=lower(%s)", (ms_email,))
        check("user stored without password", row is not None and row["password_hash"] is None)

        # Second login with the same email must reuse, not duplicate.
        with patch.object(auth_router.microsoft_client, "exchange_code",
                          return_value={"id_token": _id_token(claims)}):
            res2 = auth_router.microsoft_callback({"code": "fake-code", "state": state})
        check("second microsoft login reuses account",
              res2["user"]["id"] == res["user"]["id"])
        count = db.fetch_one(
            "SELECT count(*) AS n FROM users WHERE lower(email)=lower(%s)", (ms_email,)
        )["n"]
        check("exactly one account created", count == 1, f"count {count}")

        # The issued token is a valid platform session token.
        payload = security.decode_token(res["token"])
        check("token decodes to the new user", bool(payload) and payload.get("sub") == str(row["id"]))

        # A tampered nonce must be rejected.
        bad = dict(claims, nonce="other-nonce")
        state2 = security.create_signed_value(
            "oauth-state",
            {"nonce": nonce, "redirect_uri": "http://localhost:3002/login/microsoft"},
            ttl_seconds=600,
        )
        from fastapi import HTTPException
        with patch.object(auth_router.microsoft_client, "exchange_code",
                          return_value={"id_token": _id_token(bad)}):
            try:
                auth_router.microsoft_callback({"code": "fake-code", "state": state2})
                check("nonce mismatch rejected", False, "no exception raised")
            except HTTPException as exc:
                check("nonce mismatch rejected", exc.status_code == 401, f"status {exc.status_code}")

        # Expired state must be rejected outright.
        expired = security.create_signed_value(
            "oauth-state", {"nonce": nonce, "redirect_uri": "x"}, ttl_seconds=-1
        )
        try:
            auth_router.microsoft_callback({"code": "fake-code", "state": expired})
            check("expired state rejected", False, "no exception raised")
        except HTTPException as exc:
            check("expired state rejected", exc.status_code == 400, f"status {exc.status_code}")

        # Email stays locked until a password exists: a session alone must not
        # re-point a passwordless account at another Microsoft identity.
        try:
            auth_router.update_me(
                {"name": "微软流程测试",
                 "email": f"takeover-{uuid.uuid4().hex[:6]}@transonce.local"},
                user=row,
            )
            check("passwordless email change blocked", False, "no exception raised")
        except HTTPException as exc:
            check("passwordless email change blocked", exc.status_code == 400, f"status {exc.status_code}")

        # A microsoft-created user can set a password without knowing a "current" one.
        updated = auth_router.update_me({"name": "微软流程测试", "password": "ms-flow-pass-123"}, user=row)
        check("passwordless user can set a password", updated.get("authProvider") == "microsoft")
        row2 = db.fetch_one("SELECT * FROM users WHERE id=%s", (row["id"],))
        check("password hash stored after set", bool(row2["password_hash"]))
        ok = security.verify_password("ms-flow-pass-123", row2["password_hash"])
        check("set password verifies", ok)
    finally:
        db.execute("DELETE FROM users WHERE lower(email)=lower(%s)", (ms_email,))
        restore = {
            "passwordLoginEnabled": original["passwordLoginEnabled"],
            "registrationEnabled": original["registrationEnabled"],
            "microsoft": {
                "enabled": original["microsoft"]["enabled"],
                "tenantId": original["microsoft"]["tenantId"],
                "clientId": original["microsoft"]["clientId"],
            },
        }
        if not original["microsoft"]["clientSecret"]:
            restore["microsoft"]["clientSecret"] = ""
        platform_settings.save_auth_settings(restore)

    total = passed + len(failed)
    print(f"\n{passed}/{total} checks passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
