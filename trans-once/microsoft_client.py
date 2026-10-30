"""Minimal Microsoft identity platform (Entra ID / Azure AD) OAuth 2.0 client.

Authorization-code flow against the v2.0 endpoints, standard library only so
the backend gains no dependency (same rule as gitlab_client). The ID token is
received directly from the token endpoint over TLS, so — per OpenID Connect
Core 3.1.3.7 — signature validation may be skipped; we still validate iss/aud/
exp/nonce at the call site. Every failure raises MicrosoftAuthError with a
human-readable Chinese message.
"""
from __future__ import annotations

import base64
import json
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request

TOKEN_TIMEOUT_SECONDS = 15
AUTHORIZE_PATH = "/oauth2/v2.0/authorize"
TOKEN_PATH = "/oauth2/v2.0/token"
SCOPE = "openid profile email"


class MicrosoftAuthError(RuntimeError):
    """Microsoft OAuth call failed (network, config or unexpected response)."""


def authority_base(tenant_id: str) -> str:
    tenant = (tenant_id or "").strip() or "common"
    return f"https://login.microsoftonline.com/{urllib.parse.quote(tenant)}"


def build_authorize_url(
    tenant_id: str, client_id: str, redirect_uri: str, state: str, nonce: str
) -> str:
    query = urllib.parse.urlencode({
        "client_id": client_id,
        "response_type": "code",
        "redirect_uri": redirect_uri,
        "response_mode": "query",
        "scope": SCOPE,
        "state": state,
        "nonce": nonce,
        "prompt": "select_account",
    })
    return f"{authority_base(tenant_id)}{AUTHORIZE_PATH}?{query}"


def exchange_code(
    tenant_id: str, client_id: str, client_secret: str, code: str, redirect_uri: str
) -> dict:
    """Exchange an authorization code for a token response (id_token, ...)."""
    if not client_secret:
        raise MicrosoftAuthError("平台未配置微软登录的 Client Secret")
    body = urllib.parse.urlencode({
        "client_id": client_id,
        "client_secret": client_secret,
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": redirect_uri,
        "scope": SCOPE,
    }).encode()
    req = urllib.request.Request(
        f"{authority_base(tenant_id)}{TOKEN_PATH}",
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded",
                 "Accept": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=TOKEN_TIMEOUT_SECONDS) as resp:
            data = json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        try:
            detail = json.loads(exc.read().decode()).get("error_description", "")
        except Exception:
            detail = ""
        hint = f": {detail[:200]}" if detail else ""
        raise MicrosoftAuthError(
            f"微软登录令牌交换失败（{exc.code}）{hint}，请检查应用配置与回调地址"
        ) from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise MicrosoftAuthError(f"无法连接微软登录服务: {exc}") from exc
    except ValueError as exc:
        raise MicrosoftAuthError("微软登录服务返回了无法解析的响应") from exc
    if not isinstance(data, dict) or not data.get("id_token"):
        raise MicrosoftAuthError("微软登录响应中缺少 id_token")
    return data


def parse_id_token(id_token: str) -> dict:
    """Decode the ID token payload (no signature check — see module docstring)."""
    try:
        _, payload, _ = id_token.split(".")
        pad = "=" * (-len(payload) % 4)
        claims = json.loads(base64.urlsafe_b64decode(payload + pad))
    except Exception as exc:
        raise MicrosoftAuthError("微软登录的 id_token 无法解析") from exc
    if not isinstance(claims, dict):
        raise MicrosoftAuthError("微软登录的 id_token 内容异常")
    return claims


def validate_id_token(
    claims: dict, client_id: str, tenant_id: str, nonce: str
) -> None:
    """Cheap claim checks: right app, right issuer, not expired, right nonce."""
    if claims.get("aud") != client_id:
        raise MicrosoftAuthError("微软登录 id_token 的受众与平台配置不一致")
    issuer = claims.get("iss") or ""
    # v2.0 issuer is https://login.microsoftonline.com/{tid}/v2.0 and must
    # match the tenant we sent the user to (wildcards only for common/etc.,
    # where the tid claim fills the slot).
    expected_tenant = claims.get("tid") or ""
    if issuer != f"https://login.microsoftonline.com/{expected_tenant}/v2.0":
        raise MicrosoftAuthError("微软登录 id_token 的签发方异常")
    if tenant_id not in ("common", "organizations", "consumers") and expected_tenant.lower() != tenant_id.lower():
        raise MicrosoftAuthError("微软登录 id_token 的签发租户与平台配置不一致")
    exp = claims.get("exp")
    if not isinstance(exp, (int, float)) or exp < time.time():
        raise MicrosoftAuthError("微软登录 id_token 已过期")
    if nonce and claims.get("nonce") != nonce:
        raise MicrosoftAuthError("微软登录 id_token 的 nonce 校验失败")


def new_nonce() -> str:
    return secrets.token_urlsafe(24)
