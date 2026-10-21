"""Authentication and current-user endpoints."""
import re
import time

from fastapi import APIRouter, Body, Depends, HTTPException, Request

import db
import serializers
from config import DEFAULT_ROLE
from deps import get_current_user
from security import create_token, hash_password, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# Simple in-process brute-force guard. A multi-worker deployment should move
# this to Redis, but it removes the trivial "try passwords forever" window.
LOGIN_WINDOW_SECONDS = 600
LOGIN_MAX_FAILURES = 8
_login_failures: dict[str, list[float]] = {}


def _rate_limit_key(request: Request, email: str) -> str:
    ip = request.client.host if request.client else "unknown"
    return f"{ip}|{email}"


def _assert_login_allowed(key: str) -> None:
    now = time.monotonic()
    recent = [t for t in _login_failures.get(key, []) if now - t < LOGIN_WINDOW_SECONDS]
    _login_failures[key] = recent
    if len(_login_failures) > 5000:
        # Bound memory under email-spray attempts.
        stale = [
            k for k, v in _login_failures.items()
            if not v or now - v[-1] >= LOGIN_WINDOW_SECONDS
        ]
        for k in stale:
            _login_failures.pop(k, None)
    if len(recent) >= LOGIN_MAX_FAILURES:
        raise HTTPException(429, "登录尝试次数过多，请 10 分钟后再试")


def _public_user(user: dict) -> dict:
    return serializers.user(user)


def _memberships(user: dict) -> list[dict]:
    rows = db.fetch_all(
        """SELECT m.*, t.name AS tenant_name, t.slug AS tenant_slug, t.description AS tenant_description,
                  t.logo AS tenant_logo, t.join_policy, t.status AS tenant_status,
                  t.created_at AS tenant_created_at,
                  r.name AS role_name, r.permissions AS role_permissions, r.is_system AS role_is_system,
                  a.id AS agent_id, a.name AS agent_name,
                  (SELECT count(*) FROM tenant_members tm
                    WHERE tm.tenant_id=m.tenant_id AND tm.status='active') AS member_count
           FROM tenant_members m
           JOIN tenants t ON t.id = m.tenant_id
           LEFT JOIN roles r ON r.id = m.role_id
           LEFT JOIN agents a ON a.tenant_id = m.tenant_id AND a.owner_user_id = m.user_id
           WHERE m.user_id = %s AND m.status = 'active' AND t.status = 'active'
           ORDER BY t.name""",
        (user["id"],),
    )
    out = []
    for m in rows:
        permissions = m.get("role_permissions") or []
        out.append({
            "tenant": {
                "id": str(m["tenant_id"]),
                "name": m["tenant_name"],
                "slug": m["tenant_slug"],
                "description": m["tenant_description"],
                "logo": m["tenant_logo"],
                "joinPolicy": m.get("join_policy"),
                "status": m.get("tenant_status"),
                "createdAt": m["tenant_created_at"].isoformat() if m.get("tenant_created_at") else None,
            },
            "role": {
                "id": str(m["role_id"]) if m.get("role_id") else None,
                "name": m.get("role_name"),
                "permissions": permissions,
                "isSystem": bool(m.get("role_is_system")),
            },
            "permissions": permissions,
            "memberCount": int(m.get("member_count") or 0),
            "membershipStatus": m.get("status"),
            "isTenantAdmin": bool(m.get("is_tenant_admin")) or bool(user.get("is_super_admin")),
            "isSuperAdmin": bool(user.get("is_super_admin")),
            "agent": {"id": str(m["agent_id"]) if m.get("agent_id") else None, "name": m.get("agent_name")},
        })
    return out


@router.post("/register")
def register(body: dict = Body(...)):
    email = (body.get("email") or "").strip().lower()
    name = (body.get("name") or "").strip()
    password = body.get("password") or ""
    if not EMAIL_RE.match(email):
        raise HTTPException(400, "请输入有效的邮箱地址")
    if not name:
        raise HTTPException(400, "请输入姓名")
    if len(password) < 6:
        raise HTTPException(400, "密码至少 6 位")
    if db.fetch_one("SELECT id FROM users WHERE lower(email)=lower(%s)", (email,)):
        raise HTTPException(409, "该邮箱已注册")
    user = db.execute_returning(
        """INSERT INTO users (email, name, password_hash) VALUES (%s, %s, %s) RETURNING *""",
        (email, name, hash_password(password)),
    )
    return {"token": create_token(str(user["id"])), "user": _public_user(user)}


@router.post("/login")
def login(request: Request, body: dict = Body(...)):
    email = (body.get("email") or "").strip().lower()
    key = _rate_limit_key(request, email)
    _assert_login_allowed(key)
    user = db.fetch_one("SELECT * FROM users WHERE lower(email)=lower(%s)", (email,))
    if not user or not verify_password(body.get("password") or "", user["password_hash"]):
        _login_failures.setdefault(key, []).append(time.monotonic())
        raise HTTPException(401, "邮箱或密码错误")
    if user.get("status") == "disabled":
        raise HTTPException(403, "账号已被禁用")
    _login_failures.pop(key, None)
    return {"token": create_token(str(user["id"])), "user": _public_user(user)}


@router.get("/me")
def me(user: dict = Depends(get_current_user)):
    return {
        "user": _public_user(user),
        "memberships": _memberships(user),
    }


@router.patch("/me")
def update_me(body: dict = Body(...), user: dict = Depends(get_current_user)):
    name = body.get("name") or user["name"]
    avatar = body.get("avatar", user.get("avatar"))
    password = body.get("password")
    if password is not None:
        if len(password) < 6:
            raise HTTPException(400, "密码至少 6 位")
        # A valid session alone must not be enough to lock the real owner out.
        if not verify_password(body.get("currentPassword") or "", user["password_hash"]):
            raise HTTPException(400, "当前密码不正确")
        db.execute(
            "UPDATE users SET name=%s, avatar=%s, password_hash=%s WHERE id=%s",
            (name, avatar, hash_password(password), user["id"]),
        )
    else:
        db.execute("UPDATE users SET name=%s, avatar=%s WHERE id=%s", (name, avatar, user["id"]))
    return _public_user(db.fetch_one("SELECT * FROM users WHERE id=%s", (user["id"],)))
