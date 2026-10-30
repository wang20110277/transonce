"""Authentication and current-user endpoints."""
import re
import time
import urllib.parse

from fastapi import APIRouter, Body, Depends, HTTPException, Request

import db
import microsoft_client
import oidc_client
import platform_settings
import serializers
from config import DEFAULT_ROLE
from deps import get_current_user
from security import (
    create_signed_value,
    create_token,
    decode_oauth_state,
    hash_password,
    verify_password,
)

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
    settings = platform_settings.get_auth_settings()
    if not settings.get("registrationEnabled"):
        raise HTTPException(403, "平台已关闭新用户注册")
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
    settings = platform_settings.get_auth_settings()
    password_login_enabled = settings.get("passwordLoginEnabled")
    email = (body.get("email") or "").strip().lower()
    key = _rate_limit_key(request, email)
    _assert_login_allowed(key)
    if not password_login_enabled:
        # Safety valve: the super admin keeps password access even when the
        # switch is off, so a mis-click can never lock the platform out.
        admin = db.fetch_one(
            "SELECT * FROM users WHERE lower(email)=lower(%s) AND is_super_admin",
            (email,),
        )
        if not admin:
            raise HTTPException(403, "平台已关闭密码登录，请使用微软账号登录")
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
    name = (body.get("name") or "").strip() or user["name"]
    if not name:
        raise HTTPException(400, "请输入姓名")
    avatar = body.get("avatar", user.get("avatar"))
    email = (body.get("email") or "").strip().lower()
    if email and email != user["email"].lower():
        if not EMAIL_RE.match(email):
            raise HTTPException(400, "请输入有效的邮箱地址")
        if db.fetch_one(
            "SELECT id FROM users WHERE lower(email)=lower(%s) AND id<>%s", (email, user["id"])
        ):
            raise HTTPException(409, "该邮箱已被其他账号使用")
    password = body.get("password")
    if password is not None and len(password) < 6:
        raise HTTPException(400, "密码至少 6 位")
    # Email and password are login credentials: a valid session alone (e.g. an
    # unlocked laptop) must not be enough to take the account over. Accounts
    # created via Microsoft login have no password yet — they may set an
    # initial password from their session (there is no credential to steal),
    # but the login email only changes once a password exists and is confirmed.
    has_password = bool(user.get("password_hash"))
    if email and not has_password:
        raise HTTPException(400, "微软登录账号请先设置密码，再修改登录邮箱")
    if (password is not None or email) and has_password:
        if not verify_password(body.get("currentPassword") or "", user["password_hash"]):
            raise HTTPException(400, "当前密码不正确")
    fields: dict = {"name": name, "avatar": avatar}
    if email:
        fields["email"] = email
    if password is not None:
        fields["password_hash"] = hash_password(password)
    assigns = ", ".join(f"{col}=%s" for col in fields)
    db.execute(f"UPDATE users SET {assigns} WHERE id=%s", (*fields.values(), user["id"]))
    return _public_user(db.fetch_one("SELECT * FROM users WHERE id=%s", (user["id"],)))


# --- login configuration (public view + super-admin management) ----------

@router.get("/config")
def auth_config():
    """What the login page is allowed to render before authentication."""
    return platform_settings.public_auth_config(platform_settings.get_auth_settings())


@router.get("/settings")
def get_auth_settings(user: dict = Depends(get_current_user)):
    if not user.get("is_super_admin"):
        raise HTTPException(403, "只有超级管理员可以管理登录设置")
    return platform_settings.admin_auth_settings(platform_settings.get_auth_settings())


@router.put("/settings")
def put_auth_settings(body: dict = Body(...), user: dict = Depends(get_current_user)):
    if not user.get("is_super_admin"):
        raise HTTPException(403, "只有超级管理员可以管理登录设置")
    try:
        settings = platform_settings.save_auth_settings(body)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return platform_settings.admin_auth_settings(settings)


# --- redirect-based identity providers (Microsoft + generic OIDC) --------

def _valid_redirect_uri(redirect_uri: str) -> str:
    parsed = urllib.parse.urlsplit(redirect_uri)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise HTTPException(400, "回调地址必须是 http(s) URL")
    return redirect_uri


def _upsert_provider_user(email: str, name: str, provider: str) -> dict:
    """Find-or-create by email: an existing account is reused as-is; a
    first-time user is auto-registered without a password."""
    user = db.fetch_one("SELECT * FROM users WHERE lower(email)=lower(%s)", (email,))
    if not user:
        user = db.execute_returning(
            """INSERT INTO users (email, name, password_hash, auth_provider)
               VALUES (%s, %s, NULL, %s) RETURNING *""",
            (email, name, provider),
        )
    if user.get("status") == "disabled":
        raise HTTPException(403, "账号已被禁用")
    return user


@router.post("/microsoft/start")
def microsoft_start(body: dict = Body(...)):
    settings = platform_settings.get_auth_settings()
    ms = settings.get("microsoft") or {}
    if not platform_settings.microsoft_ready(settings):
        raise HTTPException(403, "平台未开启微软登录")
    redirect_uri = _valid_redirect_uri((body.get("redirectUri") or "").strip())
    nonce = microsoft_client.new_nonce()
    state = create_signed_value(
        "oauth-state",
        {"provider": "microsoft", "nonce": nonce, "redirect_uri": redirect_uri},
        ttl_seconds=600,
    )
    url = microsoft_client.build_authorize_url(
        ms.get("tenantId") or "common", ms.get("clientId") or "", redirect_uri, state, nonce
    )
    return {"url": url}


@router.post("/microsoft/callback")
def microsoft_callback(body: dict = Body(...)):
    settings = platform_settings.get_auth_settings()
    ms = settings.get("microsoft") or {}
    if not platform_settings.microsoft_ready(settings):
        raise HTTPException(403, "平台未开启微软登录")
    state_data = decode_oauth_state(body.get("state") or "")
    if not state_data or state_data.get("provider", "microsoft") != "microsoft":
        raise HTTPException(400, "登录状态校验失败，请重新发起微软登录")
    code = (body.get("code") or "").strip()
    if not code:
        raise HTTPException(400, "微软登录未返回授权码")

    try:
        tokens = microsoft_client.exchange_code(
            ms.get("tenantId") or "common",
            ms.get("clientId") or "",
            ms.get("clientSecret") or "",
            code,
            state_data["redirect_uri"],
        )
        claims = microsoft_client.parse_id_token(tokens["id_token"])
        microsoft_client.validate_id_token(
            claims, ms.get("clientId") or "", ms.get("tenantId") or "common",
            state_data.get("nonce") or "",
        )
    except microsoft_client.MicrosoftAuthError as e:
        raise HTTPException(401, str(e))

    email = str(claims.get("email") or claims.get("preferred_username") or "").strip().lower()
    if not EMAIL_RE.match(email):
        raise HTTPException(400, "微软账号未提供可用的邮箱地址")
    name = str(claims.get("name") or "").strip() or email.split("@", 1)[0]
    user = _upsert_provider_user(email, name, "microsoft")
    return {"token": create_token(str(user["id"])), "user": _public_user(user)}


# --- generic OIDC (Keycloak / Casdoor / Authing / Google / ...) -----------

@router.post("/oidc/start")
def oidc_start(body: dict = Body(...)):
    settings = platform_settings.get_auth_settings()
    prov = settings.get("oidc") or {}
    if not platform_settings.oidc_ready(settings):
        raise HTTPException(403, "平台未开启 OIDC 登录")
    redirect_uri = _valid_redirect_uri((body.get("redirectUri") or "").strip())
    try:
        doc = oidc_client.discover(prov.get("issuerUrl") or "")
    except oidc_client.OidcError as e:
        raise HTTPException(400, str(e))
    nonce = oidc_client.new_nonce()
    state = create_signed_value(
        "oauth-state",
        {"provider": "oidc", "nonce": nonce, "redirect_uri": redirect_uri},
        ttl_seconds=600,
    )
    url = oidc_client.build_authorize_url(
        doc["authorization_endpoint"], prov.get("clientId") or "", redirect_uri,
        state, nonce, prov.get("scope") or oidc_client.DEFAULT_SCOPE,
    )
    return {"url": url}


@router.post("/oidc/callback")
def oidc_callback(body: dict = Body(...)):
    settings = platform_settings.get_auth_settings()
    prov = settings.get("oidc") or {}
    if not platform_settings.oidc_ready(settings):
        raise HTTPException(403, "平台未开启 OIDC 登录")
    state_data = decode_oauth_state(body.get("state") or "")
    if not state_data or state_data.get("provider") != "oidc":
        raise HTTPException(400, "登录状态校验失败，请重新发起登录")
    code = (body.get("code") or "").strip()
    if not code:
        raise HTTPException(400, "登录未返回授权码")

    try:
        doc = oidc_client.discover(prov.get("issuerUrl") or "")
        tokens = oidc_client.exchange_code(
            doc["token_endpoint"], prov.get("clientId") or "",
            prov.get("clientSecret") or "", code, state_data["redirect_uri"],
        )
        claims = oidc_client.parse_id_token(tokens["id_token"])
        oidc_client.validate_id_token(
            claims, prov.get("clientId") or "", prov.get("issuerUrl") or "",
            state_data.get("nonce") or "",
        )
    except oidc_client.OidcError as e:
        raise HTTPException(401, str(e))

    email = str(claims.get("email") or claims.get("preferred_username") or "").strip().lower()
    if not EMAIL_RE.match(email):
        raise HTTPException(400, "身份服务未提供可用的邮箱地址（请确认 scope 含 email 或账号绑定了邮箱）")
    name = (
        str(claims.get("name")
            or " ".join(filter(None, [claims.get("given_name"), claims.get("family_name")]))
            or "").strip()
        or email.split("@", 1)[0]
    )
    user = _upsert_provider_user(email, name, "oidc")
    return {"token": create_token(str(user["id"])), "user": _public_user(user)}
