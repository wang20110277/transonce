"""Minimal GitLab REST client for linked code repositories.

Uses the standard library only (urllib) so the backend gains no dependency.
Every call raises `GitlabError` with a human-readable message on network,
auth or parse failures and returns plain dicts on success.
"""
from __future__ import annotations

import json
import ssl
import urllib.error
import urllib.parse
import urllib.request

from config import GITLAB_TIMEOUT_SECONDS


class GitlabError(RuntimeError):
    """GitLab API call failed (network, auth or unexpected response)."""


def normalize_base_url(url: str) -> str:
    url = (url or "").strip().rstrip("/")
    if not url:
        raise GitlabError("GitLab 地址不能为空")
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    if not urllib.parse.urlsplit(url).hostname:
        raise GitlabError("GitLab 地址格式不正确")
    return url


def _tls_context(insecure_tls: bool) -> ssl.SSLContext | None:
    """Per-connection opt-out for self-signed / IP certificates."""
    if not insecure_tls:
        return None
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


def _request(
    base_url: str, token: str, path: str, params: dict | None = None, insecure_tls: bool = False
) -> dict | list:
    if not token:
        raise GitlabError("未配置 GitLab 访问令牌")
    query = ("?" + urllib.parse.urlencode(params)) if params else ""
    req = urllib.request.Request(
        f"{base_url}/api/v4{path}{query}",
        headers={"PRIVATE-TOKEN": token, "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(
            req, timeout=GITLAB_TIMEOUT_SECONDS, context=_tls_context(insecure_tls)
        ) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        if exc.code == 401:
            raise GitlabError("GitLab 拒绝了访问令牌（401），请检查令牌是否有效") from exc
        if exc.code == 403:
            raise GitlabError("GitLab 拒绝访问（403），令牌可能缺少 read_api 权限") from exc
        raise GitlabError(f"GitLab 返回 HTTP {exc.code}") from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise GitlabError(f"无法连接 GitLab：{exc}") from exc
    except json.JSONDecodeError as exc:
        raise GitlabError("GitLab 返回了无法解析的内容，请确认地址指向 GitLab 实例") from exc


def fetch_current_user(base_url: str, token: str, insecure_tls: bool = False) -> dict:
    """Validate credentials; returns the account behind the token."""
    data = _request(base_url, token, "/user", insecure_tls=insecure_tls)
    if not isinstance(data, dict) or "id" not in data:
        raise GitlabError("GitLab /user 响应异常")
    return data


def _normalize_project(p: dict) -> dict:
    namespace = ""
    if isinstance(p.get("namespace"), dict):
        namespace = p["namespace"].get("path") or ""
    elif "/" in str(p.get("path_with_namespace") or ""):
        namespace = p["path_with_namespace"].rsplit("/", 1)[0]
    return {
        "external_id": str(p.get("id")),
        "path": p.get("path_with_namespace") or p.get("path") or "",
        "name": p.get("name") or p.get("path") or "",
        "namespace": namespace,
        "web_url": p.get("web_url"),
        "description": p.get("description"),
        "default_branch": p.get("default_branch") or "main",
        "visibility": p.get("visibility") or "private",
        "archived": bool(p.get("archived")),
        "last_activity_at": p.get("last_activity_at"),
    }


def fetch_projects(
    base_url: str, token: str, max_pages: int = 10, insecure_tls: bool = False,
    all_visible: bool = False,
) -> list[dict]:
    """List projects (offset pagination, ≤100/page).

    `all_visible=False` limits to the token user's memberships. Instance
    admins should pass True: the default listing then returns every project
    they can see, including internal/private ones they are not a member of.
    """
    params = {"simple": "true", "order_by": "path", "sort": "asc", "per_page": 100}
    if not all_visible:
        params["membership"] = "true"
    out: list[dict] = []
    for page in range(1, max_pages + 1):
        batch = _request(
            base_url, token, "/projects", {**params, "page": page},
            insecure_tls=insecure_tls,
        )
        if not isinstance(batch, list):
            raise GitlabError("GitLab /projects 响应异常")
        out.extend(_normalize_project(p) for p in batch if isinstance(p, dict))
        if len(batch) < 100:
            break
    return out
