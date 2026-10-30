"""Minimal generic OpenID Connect client (authorization-code flow).

Works with any OIDC-compliant identity provider — Keycloak, Casdoor, Authing,
Okta, Google, ... : endpoints are discovered from the issuer's
`/.well-known/openid-configuration` so the platform only stores the issuer
URL + client credentials. Standard library only (same rule as the rest of the
backend). The ID token arrives directly from the token endpoint over TLS, so
per OpenID Connect Core 3.1.3.7 signature validation may be skipped; iss/aud/
exp/nonce are still checked at the call site.
"""
from __future__ import annotations

import base64
import json
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request

DISCOVERY_TIMEOUT_SECONDS = 10
DISCOVERY_CACHE_TTL = 600  # re-discover every 10 min; endpoints rarely move
_discovery_cache: dict[str, tuple[float, dict]] = {}

DEFAULT_SCOPE = "openid profile email"


class OidcError(RuntimeError):
    """Generic OIDC call failed (network, config or unexpected response)."""


def normalize_issuer(url: str) -> str:
    issuer = (url or "").strip().rstrip("/")
    parsed = urllib.parse.urlsplit(issuer)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise OidcError("Issuer 地址必须是 http(s) URL，例如 https://sso.example.com/realms/main")
    return issuer


def discover(issuer_url: str, force: bool = False) -> dict:
    """Fetch (and cache) the issuer's discovery document."""
    issuer = normalize_issuer(issuer_url)
    now = time.monotonic()
    cached = _discovery_cache.get(issuer)
    if cached and not force and now - cached[0] < DISCOVERY_CACHE_TTL:
        return cached[1]
    req = urllib.request.Request(
        f"{issuer}/.well-known/openid-configuration",
        headers={"Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=DISCOVERY_TIMEOUT_SECONDS) as resp:
            doc = json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        raise OidcError(
            f"身份服务返回 {exc.code}，请核对 Issuer 地址是否正确、应用是否已上线"
        ) from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise OidcError(f"无法连接身份服务（{issuer}）: {exc}") from exc
    except ValueError as exc:
        raise OidcError("身份服务的发现文档不是有效 JSON") from exc
    if not isinstance(doc, dict) or not doc.get("authorization_endpoint") or not doc.get("token_endpoint"):
        raise OidcError("身份服务的发现文档缺少 authorization/token endpoint")
    if doc.get("issuer") and str(doc["issuer"]).rstrip("/") != issuer:
        raise OidcError("发现文档的 issuer 与配置的 Issuer 地址不一致，请核对")
    _discovery_cache[issuer] = (now, doc)
    return doc


def build_authorize_url(
    endpoint: str, client_id: str, redirect_uri: str, state: str, nonce: str,
    scope: str = DEFAULT_SCOPE,
) -> str:
    query = urllib.parse.urlencode({
        "client_id": client_id,
        "response_type": "code",
        "redirect_uri": redirect_uri,
        "response_mode": "query",
        "scope": scope or DEFAULT_SCOPE,
        "state": state,
        "nonce": nonce,
    })
    return f"{endpoint}?{query}"


def exchange_code(
    token_endpoint: str, client_id: str, client_secret: str, code: str, redirect_uri: str
) -> dict:
    if not client_secret:
        raise OidcError("平台未配置 OIDC 的 Client Secret")
    body = urllib.parse.urlencode({
        "client_id": client_id,
        "client_secret": client_secret,
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": redirect_uri,
        # RFC 8252: native apps SHOULD NOT send a scope on the token request
        # when it was granted at the authorize step; some providers reject it.
    }).encode()
    req = urllib.request.Request(
        token_endpoint,
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded",
                 "Accept": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=DISCOVERY_TIMEOUT_SECONDS) as resp:
            data = json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        try:
            detail = json.loads(exc.read().decode()).get("error_description", "")
        except Exception:
            detail = ""
        hint = f": {detail[:200]}" if detail else ""
        raise OidcError(f"OIDC 令牌交换失败（{exc.code}）{hint}，请检查应用配置与回调地址") from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise OidcError(f"无法连接身份服务: {exc}") from exc
    except ValueError as exc:
        raise OidcError("身份服务返回了无法解析的响应") from exc
    if not isinstance(data, dict) or not data.get("id_token"):
        raise OidcError("OIDC 响应中缺少 id_token（请确认 scope 包含 openid）")
    return data


def parse_id_token(id_token: str) -> dict:
    try:
        _, payload, _ = id_token.split(".")
        pad = "=" * (-len(payload) % 4)
        claims = json.loads(base64.urlsafe_b64decode(payload + pad))
    except Exception as exc:
        raise OidcError("OIDC 的 id_token 无法解析") from exc
    if not isinstance(claims, dict):
        raise OidcError("OIDC 的 id_token 内容异常")
    return claims


def validate_id_token(claims: dict, client_id: str, issuer_url: str, nonce: str) -> None:
    """Cheap claim checks: right app, right issuer, not expired, right nonce."""
    if str(claims.get("iss") or "").rstrip("/") != normalize_issuer(issuer_url):
        raise OidcError("id_token 的签发方与配置的 Issuer 不一致")
    aud = claims.get("aud")
    audiences = aud if isinstance(aud, list) else [aud]
    if client_id not in audiences:
        raise OidcError("id_token 的受众与平台配置不一致")
    exp = claims.get("exp")
    if not isinstance(exp, (int, float)) or exp < time.time():
        raise OidcError("id_token 已过期")
    if nonce and claims.get("nonce") != nonce:
        raise OidcError("id_token 的 nonce 校验失败")


def new_nonce() -> str:
    return secrets.token_urlsafe(24)
