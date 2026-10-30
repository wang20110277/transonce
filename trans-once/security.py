"""Password hashing, stateless auth tokens and secret-at-rest helpers.

Everything here uses the standard library only so the backend has no extra
crypto dependency. Passwords use PBKDF2-HMAC-SHA256; tokens are signed
JWT-compatible HS256 values; environment secrets are encrypted with a
keystream derived from SECRET_KEY (MVP only — swap for KMS/Vault in prod).
"""
import base64
import hashlib
import hmac
import json
import os
import secrets
import time

SECRET_KEY = os.getenv("SECRET_KEY", "transonce-dev-secret-change-me")
TOKEN_TTL_HOURS = int(os.getenv("TOKEN_TTL_HOURS", "168"))


def _b64e(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _b64d(data: str) -> bytes:
    pad = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + pad)


# --- passwords -----------------------------------------------------------

PBKDF2_ITERATIONS = 200_000


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PBKDF2_ITERATIONS)
    return f"pbkdf2${PBKDF2_ITERATIONS}${_b64e(salt)}${_b64e(digest)}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, iterations, salt, expected = stored.split("$")
        digest = hashlib.pbkdf2_hmac(
            "sha256", password.encode(), _b64d(salt), int(iterations)
        )
        return hmac.compare_digest(digest, _b64d(expected))
    except Exception:
        return False


# --- tokens --------------------------------------------------------------

def _sign(message: bytes) -> bytes:
    return hmac.new(SECRET_KEY.encode(), message, hashlib.sha256).digest()


def create_token(user_id: str) -> str:
    now = int(time.time())
    body = {"sub": user_id, "iat": now, "exp": now + TOKEN_TTL_HOURS * 3600}
    header = _b64e(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    payload = _b64e(json.dumps(body).encode())
    signing_input = f"{header}.{payload}".encode()
    return f"{header}.{payload}.{_b64e(_sign(signing_input))}"


def decode_token(token: str) -> dict | None:
    data = decode_signed_value(token)
    if data and data.get("purpose") in (None, "session"):
        return data
    return None


# --- signed values (OAuth state, one-time tickets) -----------------------

def create_signed_value(purpose: str, data: dict, ttl_seconds: int) -> str:
    """Sign an arbitrary payload for round-tripping through a third party
    (e.g. the OAuth `state` parameter). Same HS256 shape as session tokens but
    bound to a distinct `purpose`, so one can never be replayed as the other."""
    now = int(time.time())
    body = {**data, "purpose": purpose, "iat": now, "exp": now + ttl_seconds}
    header = _b64e(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    payload = _b64e(json.dumps(body).encode())
    signing_input = f"{header}.{payload}".encode()
    return f"{header}.{payload}.{_b64e(_sign(signing_input))}"


def decode_signed_value(token: str) -> dict | None:
    try:
        header, payload, signature = token.split(".")
        signing_input = f"{header}.{payload}".encode()
        if not hmac.compare_digest(_b64d(signature), _sign(signing_input)):
            return None
        data = json.loads(_b64d(payload))
        if int(data.get("exp", 0)) < int(time.time()):
            return None
        return data
    except Exception:
        return None


def decode_oauth_state(token: str) -> dict | None:
    data = decode_signed_value(token)
    if data and data.get("purpose") == "oauth-state":
        return data
    return None


# --- environment secrets (MVP) ------------------------------------------

def _keystream(nonce: bytes, length: int) -> bytes:
    key = hashlib.sha256(SECRET_KEY.encode()).digest()
    out = bytearray()
    counter = 0
    while len(out) < length:
        out += hashlib.sha256(key + nonce + counter.to_bytes(4, "big")).digest()
        counter += 1
    return bytes(out[:length])


def encrypt_secret(plain: str | None) -> str | None:
    if not plain:
        return None
    nonce = secrets.token_bytes(16)
    data = plain.encode()
    stream = _keystream(nonce, len(data))
    cipher = bytes(a ^ b for a, b in zip(data, stream))
    return _b64e(nonce + cipher)


def decrypt_secret(stored: str | None) -> str | None:
    if not stored:
        return None
    raw = _b64d(stored)
    nonce, cipher = raw[:16], raw[16:]
    stream = _keystream(nonce, len(cipher))
    return bytes(a ^ b for a, b in zip(cipher, stream)).decode(errors="replace")


def mask_secret(value: str | None) -> str | None:
    if not value:
        return None
    return "••••••" + value[-2:] if len(value) > 2 else "••••••"
