"""End-to-end smoke tests against a running TransOnce API.

Usage (backend must be running on :9005):

    cd trans-once && python3 tests/smoke.py
    API_BASE=http://localhost:9005 python3 tests/smoke.py
    SMOKE_ONLY=alerts python3 tests/smoke.py   # only the alert-notification section

The suite is self-provisioning: there is no demo seed data any more, so it
creates (once, idempotently) a dedicated tenant, its member accounts and the
fixtures the checks need, and reuses them on later runs. Beyond that it stays
non-destructive: it only reads data, reveals a masked secret (which writes an
audit log), runs monitor health checks, creates/deletes one throwaway
conversation, and settles one repo access request (idempotent across re-runs).
The alert section talks to an in-process fake group robot. The profile
self-service section renames the dev account and round-trips its email/password,
restoring each value before moving on.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

API = os.getenv("API_BASE", "http://localhost:9005").rstrip("/")
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "admin@transonce.local")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin123")
# Fixture accounts owned by this suite (kept across runs for idempotency).
TENANT_SLUG = os.getenv("SMOKE_TENANT_SLUG", "smoke")
PRODUCT_EMAIL = os.getenv("PRODUCT_EMAIL", "smoke-product@transonce.local")
PRODUCT_PASSWORD = os.getenv("PRODUCT_PASSWORD", "smoke-pass-123")
DEV_EMAIL = os.getenv("DEV_EMAIL", "smoke-dev@transonce.local")
DEV_PASSWORD = os.getenv("DEV_PASSWORD", "smoke-pass-123")
JOIN_EMAIL = os.getenv("JOIN_EMAIL", "smoke-join@transonce.local")
JOIN_PASSWORD = os.getenv("JOIN_PASSWORD", "smoke-pass-123")
# 告警通知一节的夹具：只有告警中心权限的账号，以及假群机器人用的加签密钥。
ALERT_EMAIL = os.getenv("ALERT_EMAIL", "smoke-alert@transonce.local")
ALERT_PASSWORD = os.getenv("ALERT_PASSWORD", "smoke-pass-123")
BOT_SECRET = "SECsmokesecret"
ISSUE_TITLE = "冒烟：手工录入的问题"
PROBE_NAME = "冒烟失败探针"

SAMPLE_NOTES = """时间：上午 10:00
参会人：产品负责人、研发、测试、DevOps

1. 产品负责人：本期目标是让会议纪要可以直接驱动需求提取，减少手工整理。
2. 研发：需求要能关联来源会议，支持验收标准和优先级，并且保留 Agent 运行记录。
3. 测试：每条需求必须有可验证的验收标准，空纪要和纯闲聊要有兜底提示。
4. DevOps：需求完成后要能一键生成制品、跑流水线、部署到测试环境，并自动纳入健康监控。
5. 决议：先打通会议→需求→设计→研发→测试→部署→监控的闭环，生产发布保留人工审批。
"""

passed = 0
failed: list[str] = []


class _FakeGitlabHandler(BaseHTTPRequestHandler):
    """Minimal GitLab API stand-in so the live-connection path is exercised
    end-to-end (create validates via /user, sync lists /projects)."""

    projects = [
        {
            "id": 101, "path": "smoke/retail-web", "name": "retail-web",
            "namespace": {"path": "smoke"},
            "path_with_namespace": "smoke/retail-web",
            "web_url": "http://gitlab.smoke.local/smoke/retail-web",
            "description": "冒烟 Web 前端", "default_branch": "main",
            "visibility": "private", "archived": False, "last_activity_at": "2026-10-30T00:00:00Z",
        },
        {
            "id": 102, "path": "smoke/retail-api", "name": "retail-api",
            "namespace": {"path": "smoke"},
            "path_with_namespace": "smoke/retail-api",
            "web_url": "http://gitlab.smoke.local/smoke/retail-api",
            "description": "冒烟 API 服务", "default_branch": "main",
            "visibility": "internal", "archived": False, "last_activity_at": "2026-10-29T00:00:00Z",
        },
        {
            "id": 103, "path": "smoke/platform-infra", "name": "platform-infra",
            "namespace": {"path": "smoke"},
            "path_with_namespace": "smoke/platform-infra",
            "web_url": "http://gitlab.smoke.local/smoke/platform-infra",
            "description": "冒烟基础设施", "default_branch": "master",
            "visibility": "private", "archived": True, "last_activity_at": "2026-10-28T00:00:00Z",
        },
    ]

    def do_GET(self) -> None:  # noqa: N802 - http.server API
        if self.path.startswith("/api/v4/user"):
            body = {"id": 1, "username": "smoke-bot", "is_admin": False}
        elif self.path.startswith("/api/v4/projects"):
            body = self.projects
        else:
            self.send_error(404)
            return
        payload = json.dumps(body).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args) -> None:  # keep smoke output clean
        pass


def _start_fake_gitlab() -> str:
    server = ThreadingHTTPServer(("127.0.0.1", 0), _FakeGitlabHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return f"http://127.0.0.1:{server.server_port}"


class _FakeOidcHandler(BaseHTTPRequestHandler):
    """Minimal OpenID Connect provider so the generic-OIDC login path runs
    end-to-end (discovery → authorize → token) without an external IdP."""

    CLIENT_ID = "smoke-oidc-client"
    EMAIL = "smoke-oidc@transonce.local"
    _nonce = ""

    def log_message(self, *args) -> None:  # keep smoke output clean
        pass

    def _json(self, obj, status = 200):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    @property
    def _base(self) -> str:
        return f"http://127.0.0.1:{self.server.server_port}"

    def do_GET(self) -> None:  # noqa: N802 (http.server naming)
        url = urllib.parse.urlsplit(self.path)
        if url.path == "/.well-known/openid-configuration":
            self._json({
                "issuer": self._base,
                "authorization_endpoint": f"{self._base}/authorize",
                "token_endpoint": f"{self._base}/token",
                "response_types_supported": ["code"],
            })
            return
        if url.path == "/authorize":
            q = urllib.parse.parse_qs(url.query)
            _FakeOidcHandler._nonce = q.get("nonce", [""])[0]
            loc = f"{q['redirect_uri'][0]}?code=smoke-oidc-code&state={q['state'][0]}"
            self.send_response(302)
            self.send_header("location", loc)
            self.end_headers()
            return
        self._json({"error": "not_found"}, 404)

    def do_POST(self) -> None:  # noqa: N802
        url = urllib.parse.urlsplit(self.path)
        if url.path != "/token":
            self._json({"error": "not_found"}, 404)
            return
        form = urllib.parse.parse_qs(self.rfile.read(int(self.headers.get("content-length", 0))).decode())
        if form.get("grant_type") != ["authorization_code"] or form.get("code") != ["smoke-oidc-code"]:
            self._json({"error": "invalid_grant", "error_description": "bad code"}, 400)
            return

        def b64e(obj: dict) -> str:
            return base64.urlsafe_b64encode(json.dumps(obj).encode()).rstrip(b"=").decode()

        claims = {
            "iss": self._base,
            "aud": _FakeOidcHandler.CLIENT_ID,
            "exp": int(time.time()) + 300,
            "nonce": _FakeOidcHandler._nonce,
            "email": _FakeOidcHandler.EMAIL,
            "name": "OIDC 冒烟用户",
        }
        id_token = f"{b64e({'alg': 'none', 'typ': 'JWT'})}.{b64e(claims)}."
        self._json({"access_token": "at", "token_type": "Bearer", "id_token": id_token})


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: N802
        return None


def _start_fake_oidc() -> str:
    server = ThreadingHTTPServer(("127.0.0.1", 0), _FakeOidcHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return f"http://127.0.0.1:{server.server_port}"


class _FakeBotHandler(BaseHTTPRequestHandler):
    """Group-robot stand-in for DingTalk / WeCom / Feishu. Records every
    request and recomputes the signature with the shared secret, so the checks
    can tell a correctly signed call from an unsigned one."""

    SECRET = "SECsmokesecret"
    requests: list[dict] = []
    lock = threading.Lock()

    def log_message(self, *args) -> None:  # keep smoke output clean
        pass

    def do_POST(self) -> None:  # noqa: N802 - http.server API
        url = urllib.parse.urlsplit(self.path)
        raw = self.rfile.read(int(self.headers.get("content-length", 0))).decode(errors="replace")
        try:
            body = json.loads(raw)
        except json.JSONDecodeError:
            body = {}
        query = urllib.parse.parse_qs(url.query)
        timestamp = (query.get("timestamp") or [body.get("timestamp", "")])[0]
        sign = (query.get("sign") or [body.get("sign", "")])[0]
        # 算法照各平台文档：钉钉以密钥为 key 对 "timestamp + 换行 + 密钥" 签名，
        # 飞书以 "timestamp + 换行 + 密钥" 为 key 对空串签名。
        if url.path.startswith("/dingtalk"):
            key, text = self.SECRET.encode(), f"{timestamp}\n{self.SECRET}".encode()
        else:
            key, text = f"{timestamp}\n{self.SECRET}".encode(), b""
        expected = base64.b64encode(hmac.new(key, text, hashlib.sha256).digest()).decode()
        with self.lock:
            self.requests.append(
                {"path": url.path, "body": body, "signed": bool(timestamp) and sign == expected}
            )
        if url.path.startswith("/feishu"):
            payload = {"code": 0, "msg": "success", "data": {}}
        elif url.path.startswith("/fail"):
            payload = {"errcode": 310000, "errmsg": "keywords not in content"}
        else:
            payload = {"errcode": 0, "errmsg": "ok"}
        data = json.dumps(payload).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def _start_fake_bot() -> str:
    server = ThreadingHTTPServer(("127.0.0.1", 0), _FakeBotHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return f"http://127.0.0.1:{server.server_port}"


def check(name: str, condition: bool, detail: str = "") -> None:
    global passed
    if condition:
        passed += 1
        print(f"  ✓ {name}")
    else:
        failed.append(name)
        print(f"  ✗ {name}{(' — ' + detail) if detail else ''}")


def call(method: str, path: str, body=None, token: str | None = None, expect: int | None = 200,
         timeout: int = 45):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            status = resp.status
            raw = resp.read().decode()
    except urllib.error.HTTPError as exc:
        status = exc.code
        raw = exc.read().decode(errors="replace")
    except urllib.error.URLError as exc:
        raise SystemExit(f"Cannot reach API at {API}: {exc}") from exc
    except TimeoutError as exc:
        raise AssertionError(f"{method} {path} timed out after {timeout}s") from exc
    try:
        payload = json.loads(raw) if raw else None
    except json.JSONDecodeError:
        payload = raw
    if expect is not None and status != expect:
        raise AssertionError(f"{method} {path} -> {status} (expected {expect}): {raw[:400]}")
    return status, payload


def login(email: str, password: str) -> dict:
    _, out = call("POST", "/api/auth/login", {"email": email, "password": password})
    return out


def _ensure_user(email: str, name: str, password: str) -> str:
    """Register the fixture account once; return a fresh token either way."""
    status, out = call(
        "POST", "/api/auth/register",
        {"email": email, "name": name, "password": password}, expect=None,
    )
    if status == 200:
        return out["token"]
    if status in (409, 403):
        # 409 = registered on a previous run; 403 = registration disabled on
        # this platform — the fixture must already exist, log in instead.
        return login(email, password)["token"]
    raise AssertionError(f"register {email} -> {status}: {out}")


def bootstrap(tenant_slug: str) -> tuple[str, str, str]:
    """Create (once) the smoke tenant, its member accounts and base fixtures.

    Returns (tenant_id, product_token, dev_token).
    """
    admin = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    _, mine = call("GET", "/api/tenants", token=admin["token"])
    entry = next((t for t in mine["items"] if t["tenant"]["slug"] == tenant_slug), None)
    if entry is None:
        _, entry = call(
            "POST", "/api/tenants",
            {"name": "冒烟测试租户", "slug": tenant_slug}, token=admin["token"],
        )
    tenant_id = entry["tenant"]["id"]
    product_token = _ensure_user(PRODUCT_EMAIL, "冒烟产品", PRODUCT_PASSWORD)
    dev_token = _ensure_user(DEV_EMAIL, "冒烟研发", DEV_PASSWORD)
    _, roles = call("GET", f"/api/tenants/{tenant_id}/roles", token=admin["token"])
    role_ids = {r["name"]: r["id"] for r in roles}
    for email, role_name in [
        (PRODUCT_EMAIL, "产品负责人"), (DEV_EMAIL, "研发工程师"),
    ]:
        status, _ = call(
            "POST", f"/api/tenants/{tenant_id}/members",
            {"email": email, "roleId": role_ids[role_name]},
            token=admin["token"], expect=None,
        )
        if status not in (200, 409):  # 409 = already a member from a previous run
            raise AssertionError(f"add member {email} -> {status}")
    return tenant_id, product_token, dev_token


def ensure_delivery_fixtures(tenant_id: str, admin_token: str) -> None:
    """Environments, monitor, GitLab catalog, project chain — idempotent."""
    _, envs = call("GET", f"/api/tenants/{tenant_id}/environments", token=admin_token)
    by_name = {e["name"]: e for e in envs}
    if "冒烟测试环境" not in by_name:
        _, row = call(
            "POST", f"/api/tenants/{tenant_id}/environments",
            {
                "name": "冒烟测试环境", "kind": "test",
                "baseUrl": "http://localhost:9005/api/health", "ip": "127.0.0.1",
                "username": "deploy", "password": "smoke-pass-123",
            },
            token=admin_token,
        )
        by_name[row["name"]] = row
    if "冒烟生产环境" not in by_name:
        call(
            "POST", f"/api/tenants/{tenant_id}/environments",
            {
                "name": "冒烟生产环境", "kind": "production",
                "baseUrl": "https://smoke.transonce.local", "ip": "10.0.0.10",
                "username": "deploy", "password": "smoke-prod-123",
            },
            token=admin_token,
        )
    _, monitors = call("GET", f"/api/tenants/{tenant_id}/monitors", token=admin_token)
    if not monitors:
        call(
            "POST", f"/api/tenants/{tenant_id}/monitors",
            {"environmentId": by_name["冒烟测试环境"]["id"], "name": "冒烟健康检查"},
            token=admin_token,
        )
    _, conns = call("GET", f"/api/tenants/{tenant_id}/gitlab/connections", token=admin_token)
    if not conns:
        _, conn = call(
            "POST", f"/api/tenants/{tenant_id}/gitlab/connections",
            {"name": "冒烟 GitLab", "baseUrl": _start_fake_gitlab(), "token": "smoke-token"},
            token=admin_token,
        )
        call("POST", f"/api/tenants/{tenant_id}/gitlab/connections/{conn['id']}/sync", {}, token=admin_token)
    _, projects = call("GET", f"/api/tenants/{tenant_id}/projects", token=admin_token)
    if not projects:
        _, project = call(
            "POST", f"/api/tenants/{tenant_id}/projects",
            {"name": "冒烟项目", "description": "冒烟测试自建项目"}, token=admin_token,
        )
        call(
            "POST", f"/api/tenants/{tenant_id}/projects/{project['id']}/systems",
            {"name": "冒烟系统", "description": "FastAPI 冒烟服务"}, token=admin_token,
        )
    _, meetings = call("GET", f"/api/tenants/{tenant_id}/meetings", token=admin_token)
    if not meetings:
        _, meeting = call(
            "POST", f"/api/tenants/{tenant_id}/meetings",
            {"title": "冒烟：会议纪要驱动研发闭环评审", "rawNotes": SAMPLE_NOTES},
            token=admin_token,
        )
        call("POST", f"/api/tenants/{tenant_id}/meetings/{meeting['id']}/extract?save=true", {}, token=admin_token, timeout=300)
    _, requirements = call("GET", f"/api/tenants/{tenant_id}/requirements", token=admin_token)
    if requirements:
        first = requirements[0]
        if not (first.get("prototype") and first.get("architecture")):
            call("POST", f"/api/tenants/{tenant_id}/requirements/{first['id']}/design", {}, token=admin_token)
        _, artifacts = call("GET", f"/api/tenants/{tenant_id}/artifacts", token=admin_token)
        if not artifacts:
            call("POST", f"/api/tenants/{tenant_id}/requirements/{first['id']}/code", {}, token=admin_token)


def _summary() -> int:
    total = passed + len(failed)
    print(f"\n{'─' * 48}\n{passed}/{total} checks passed")
    if failed:
        print("Failed checks:")
        for name in failed:
            print(f"  - {name}")
        return 1
    print("All smoke checks passed ✓\n")
    return 0


def ensure_alert_viewer(tenant_id: str, admin_token: str) -> str:
    """A member whose custom role only has `alerts`: may enter issues, may not
    manage channels. Created once, like the other fixture accounts."""
    token = _ensure_user(ALERT_EMAIL, "冒烟告警", ALERT_PASSWORD)
    _, roles = call("GET", f"/api/tenants/{tenant_id}/roles", token=admin_token)
    role = next((r for r in roles if r["name"] == "冒烟告警查看"), None)
    if role is None:
        _, role = call(
            "POST", f"/api/tenants/{tenant_id}/roles",
            {"name": "冒烟告警查看", "description": "冒烟夹具：只有告警中心权限", "permissions": ["alerts"]},
            token=admin_token,
        )
    _, members = call("GET", f"/api/tenants/{tenant_id}/members", token=admin_token)
    if not any(m.get("email") == ALERT_EMAIL for m in members):
        status, out = call(
            "POST", f"/api/tenants/{tenant_id}/members", {"email": ALERT_EMAIL, "roleId": role["id"]},
            token=admin_token, expect=None,
        )
        if status not in (200, 409):
            raise AssertionError(f"add member {ALERT_EMAIL} -> {status}: {out}")
    return token


def section_alert_notifications(tenant_id: str, admin: dict, product_token: str, dev_token: str) -> None:
    """Alert channels (钉钉 / 企业微信 / 飞书), the delivery log, manual issues
    and the monitor → group push. Fixtures are created once and reused."""
    print("\n[alert channels & notifications]")
    admin_token = admin["token"]
    base = f"/api/tenants/{tenant_id}"

    _, catalog = call("GET", "/api/permissions", token=admin_token, expect=None)
    items = catalog.get("items") if isinstance(catalog, dict) else (catalog or [])
    check("permission catalog lists alert.channel.manage",
          any(i.get("id") == "alert.channel.manage" for i in items or []))
    _, roles = call("GET", f"{base}/roles", token=admin_token, expect=None)
    devops = next((r for r in (roles or []) if r.get("name") == "DevOps 工程师"), None)
    check("DevOps preset role gained alert.channel.manage",
          bool(devops) and "alert.channel.manage" in (devops.get("permissions") or []))

    # --- 通道夹具与读写接口 ---
    def ensure_channel(name: str, provider: str, path: str, secret: str | None, events: dict) -> dict | None:
        """第一次创建通道；之后每轮把地址指到本轮启动的假机器人上。"""
        _, channels = call("GET", f"{base}/alert-channels", token=admin_token, expect=None)
        found = next((c for c in (channels or []) if isinstance(c, dict) and c.get("name") == name), None)
        body = {"name": name, "provider": provider, "webhook": f"{bot}{path}", "events": events}
        if secret:
            body["secret"] = secret
        if found:
            status, row = call("PATCH", f"{base}/alert-channels/{found['id']}", body, token=admin_token, expect=None)
        else:
            status, row = call("POST", f"{base}/alert-channels", body, token=admin_token, expect=None)
        return row if status == 200 and isinstance(row, dict) else None

    bot = _start_fake_bot()
    _FakeBotHandler.requests.clear()
    ding = ensure_channel("冒烟钉钉通道", "dingtalk", "/dingtalk?access_token=smoke-token", BOT_SECRET,
                          {"monitor": True, "manual": True, "status": False})
    wecom = ensure_channel("冒烟企微通道", "wecom", "/wecom?key=smoke-key", None,
                           {"monitor": True, "manual": True, "status": True})
    feishu = ensure_channel("冒烟飞书通道", "feishu", "/feishu/hook-token-9f3e", BOT_SECRET,
                            {"monitor": True, "manual": True, "status": True})
    failing = ensure_channel("冒烟失败通道", "dingtalk", "/fail", None,
                             {"monitor": False, "manual": False, "status": False})
    check("alert channel fixtures upserted",
          all(isinstance(c, dict) and c.get("id") for c in (ding, wecom, feishu, failing)))

    _, channels = call("GET", f"{base}/alert-channels", token=admin_token, expect=None)
    channels = channels if isinstance(channels, list) else []
    check("channel list never returns plaintext webhook or secret",
          bool(channels) and all("webhook" not in c and "secret" not in c for c in channels)
          and not any(plain in json.dumps(channels) for plain in ("smoke-token", "smoke-key", "SECsmokesecret")))
    check("webhook is masked to host plus last four characters",
          bool(ding) and ding.get("webhookMasked") == f"{bot}/dingtalk?••••••oken",
          str((ding or {}).get("webhookMasked")))
    check("feishu path token is masked",
          bool(feishu) and feishu.get("webhookMasked") == f"{bot}/feishu/••••••9f3e",
          str((feishu or {}).get("webhookMasked")))
    check("signing secret is stored encrypted and returned masked",
          bool(ding) and ding.get("hasSecret") is True
          and str(ding.get("secretMasked") or "").startswith("••••••"),
          str((ding or {}).get("secretMasked")))
    check("wecom channel has no secret", bool(wecom) and wecom.get("hasSecret") is False)

    def post_channel(body: dict) -> int:
        status, _ = call("POST", f"{base}/alert-channels", body, token=admin_token, expect=None)
        return status

    check("unknown provider rejected",
          post_channel({"name": "x", "provider": "slack", "webhook": f"{bot}/dingtalk"}) == 400)
    check("non-http webhook rejected",
          post_channel({"name": "x", "provider": "dingtalk", "webhook": "ftp://robot.example/send"}) == 400)
    check("cloud metadata webhook rejected",
          post_channel({"name": "x", "provider": "dingtalk",
                        "webhook": "http://metadata.google.internal/computeMetadata/v1/"}) == 400)
    check("wecom rejects a signing secret",
          post_channel({"name": "x", "provider": "wecom", "webhook": f"{bot}/wecom", "secret": "s"}) == 400)
    check("missing webhook rejected", post_channel({"name": "x", "provider": "dingtalk"}) == 400)
    check("webhook with embedded credentials rejected",
          post_channel({"name": "x", "provider": "dingtalk", "webhook": "http://user:pass@127.0.0.1/dingtalk"}) == 400)
    check("link-local webhook rejected",
          post_channel({"name": "x", "provider": "dingtalk",
                        "webhook": "http://169.254.169.254/latest/meta-data"}) == 400)
    status, created = call("POST", f"{base}/alert-channels",
                           {"name": "x", "provider": "dingtalk", "webhook": f"{bot}/dingtalk?access_token=sm oke"},
                           token=admin_token, expect=None)
    check("webhook with whitespace inside rejected", status == 400, f"status {status}")
    if status == 200:  # 校验还没生效时（先写检查的那一步），别把它留在库里
        call("DELETE", f"{base}/alert-channels/{created['id']}", token=admin_token, expect=None)

    alert_token = ensure_alert_viewer(tenant_id, admin_token)
    status, _ = call("GET", f"{base}/alert-channels", token=product_token, expect=None)
    check("member without alerts cannot list channels", status == 403, f"status {status}")
    status, mine = call("GET", f"{base}/alert-channels", token=alert_token, expect=None)
    check("alerts-only member can read channels (masked)",
          status == 200 and isinstance(mine, list) and all("webhook" not in c for c in mine),
          f"status {status}")
    status, _ = call("POST", f"{base}/alert-channels", {"name": "x", "provider": "dingtalk", "webhook": f"{bot}/dingtalk"},
                     token=alert_token, expect=None)
    check("alerts-only member cannot create channels", status == 403, f"status {status}")
    status, _ = call("GET", f"{base}/alert-channels/deliveries", token=alert_token, expect=None)
    check("alerts-only member cannot list all deliveries", status == 403, f"status {status}")
    if ding:
        status, _ = call("POST", f"{base}/alert-channels/{ding['id']}/test", {}, token=alert_token, expect=None)
        check("alerts-only member cannot send test messages", status == 403, f"status {status}")
        status, _ = call("PATCH", f"{base}/alert-channels/{ding['id']}", {"name": "x"}, token=alert_token, expect=None)
        check("alerts-only member cannot update channels", status == 403, f"status {status}")
        status, _ = call("DELETE", f"{base}/alert-channels/{ding['id']}", token=alert_token, expect=None)
        check("alerts-only member cannot delete channels", status == 403, f"status {status}")

    # --- 测试消息与推送记录 ---
    def last_request() -> dict:
        return _FakeBotHandler.requests[-1] if _FakeBotHandler.requests else {}

    if ding and wecom and feishu and failing:
        _FakeBotHandler.requests.clear()
        _, res = call("POST", f"{base}/alert-channels/{ding['id']}/test", {}, token=admin_token, expect=None)
        req = last_request()
        check("test message reaches the dingtalk robot as signed markdown",
              isinstance(res, dict) and res.get("status") == "sent" and res.get("event") == "test"
              and req.get("path") == "/dingtalk" and req.get("signed") is True
              and req.get("body", {}).get("msgtype") == "markdown"
              and req.get("body", {}).get("markdown", {}).get("title") == "【TransOnce 告警】测试消息",
              f"{str(res)[:120]} {str(req)[:160]}")
        _, res = call("POST", f"{base}/alert-channels/{wecom['id']}/test", {}, token=admin_token, expect=None)
        body = last_request().get("body", {})
        content = body.get("markdown", {}).get("content", "")
        check("test message reaches the wecom robot as markdown under 4096 bytes",
              isinstance(res, dict) and res.get("status") == "sent" and body.get("msgtype") == "markdown"
              and 0 < len(content.encode()) <= 4096, str(res)[:120])
        _, res = call("POST", f"{base}/alert-channels/{feishu['id']}/test", {}, token=admin_token, expect=None)
        req = last_request()
        post = req.get("body", {}).get("content", {}).get("post", {}).get("zh_cn", {})
        check("test message reaches the feishu robot as signed rich text",
              isinstance(res, dict) and res.get("status") == "sent" and req.get("signed") is True
              and req.get("body", {}).get("msg_type") == "post"
              and post.get("title") == "【TransOnce 告警】测试消息",
              f"{str(res)[:120]} {str(req)[:160]}")
        _, res = call("POST", f"{base}/alert-channels/{failing['id']}/test", {}, token=admin_token, expect=None)
        check("a platform error is recorded as a failed delivery",
              isinstance(res, dict) and res.get("status") == "failed" and "310000" in str(res.get("error")),
              str(res)[:160])
        _, log = call("GET", f"{base}/alert-channels/deliveries", token=admin_token, expect=None)
        check("delivery log lists the test messages",
              isinstance(log, list) and sum(1 for d in log if d.get("event") == "test") >= 4)

        # --- 修改通道：留空保留，空串清除 ---
        call("PATCH", f"{base}/alert-channels/{ding['id']}", {"name": "冒烟钉钉通道"}, token=admin_token, expect=None)
        _, one = call("GET", f"{base}/alert-channels", token=admin_token, expect=None)
        after = next((c for c in (one or []) if c.get("id") == ding["id"]), {})
        check("omitted webhook and secret are kept",
              after.get("hasSecret") is True and after.get("webhookMasked") == ding.get("webhookMasked"),
              str(after)[:160])
        call("PATCH", f"{base}/alert-channels/{ding['id']}", {"secret": ""}, token=admin_token, expect=None)
        _, one = call("GET", f"{base}/alert-channels", token=admin_token, expect=None)
        after = next((c for c in (one or []) if c.get("id") == ding["id"]), {})
        check("empty secret clears the stored one", after.get("hasSecret") is False)
        call("PATCH", f"{base}/alert-channels/{ding['id']}", {"secret": BOT_SECRET}, token=admin_token, expect=None)
        _, one = call("GET", f"{base}/alert-channels", token=admin_token, expect=None)
        after = next((c for c in (one or []) if c.get("id") == ding["id"]), {})
        check("a new secret replaces the cleared one", after.get("hasSecret") is True)

        # --- 换平台必须重填地址；换到企业微信时密钥清空（企业微信不支持签名） ---
        status, _ = call("PATCH", f"{base}/alert-channels/{ding['id']}", {"provider": "feishu"},
                         token=admin_token, expect=None)
        check("changing the provider requires a new webhook", status == 400, f"status {status}")
        status, switched = call("PATCH", f"{base}/alert-channels/{ding['id']}",
                                {"provider": "wecom", "webhook": f"{bot}/wecom?key=switched"},
                                token=admin_token, expect=None)
        check("switching to wecom clears the secret",
              status == 200 and isinstance(switched, dict) and switched.get("hasSecret") is False,
              f"status {status} {str(switched)[:160]}")
        # 改回原样。还原失败会直接报错，免得后面的检查因为夹具不对而莫名失败。
        call("PATCH", f"{base}/alert-channels/{ding['id']}",
             {"provider": "dingtalk", "webhook": f"{bot}/dingtalk?access_token=smoke-token", "secret": BOT_SECRET,
              "events": {"monitor": True, "manual": True, "status": False}},
             token=admin_token)
        status, _ = call("DELETE", f"{base}/alert-channels/{failing['id']}", token=admin_token, expect=None)
        check("channel can be deleted", status == 200, f"status {status}")
        _, log = call("GET", f"{base}/alert-channels/deliveries", token=admin_token, expect=None)
        check("delivery history survives channel deletion",
              isinstance(log, list) and any(d.get("channelName") == "冒烟失败通道" and d.get("channelId") is None
                                            for d in log))

    # --- 手工录入问题 ---
    _, members = call("GET", f"{base}/members", token=admin_token)
    notified = {m["userId"]: m["name"] for m in members if m.get("email") in (PRODUCT_EMAIL, DEV_EMAIL)}
    check("two fixture members to notify exist", len(notified) == 2, str(sorted(notified)))
    _, envs = call("GET", f"{base}/environments", token=admin_token)
    test_env = next((e for e in envs if e["name"] == "冒烟测试环境"), envs[0])
    ding_id, wecom_id, feishu_id = ((c or {}).get("id") for c in (ding, wecom, feishu))

    def paths_since() -> list[str]:
        """自上次清空以来假机器人收到的请求，按平台名（地址的第一段）排序。通道是并行发送的。"""
        return sorted(r["path"].split("/")[1] for r in _FakeBotHandler.requests)

    def mentions(names: list[str]) -> bool:
        """自上次清空以来的请求里，是否有一条消息同时写了这些姓名。"""
        return any(
            all(name in json.dumps(r["body"], ensure_ascii=False) for name in names)
            for r in _FakeBotHandler.requests
        )

    def alerts_listed() -> list[dict]:
        _, out = call("GET", f"{base}/alerts?limit=500", token=admin_token, expect=None)
        return out if isinstance(out, list) else []

    def post_issue(body: dict, token: str | None = None) -> int:
        status, _ = call("POST", f"{base}/alerts", body, token=token or admin_token, expect=None)
        return status

    issue_body = {
        "title": ISSUE_TITLE, "severity": "warning", "detail": "冒烟：支付回调偶发超时，需要排查。",
        "notifiedUserIds": list(notified), "environmentId": test_env["id"],
    }
    check("manual issue rejects a user who is not an active member",
          post_issue({**issue_body, "notifiedUserIds": [str(uuid.uuid4())]}) == 400)
    check("manual issue rejects a blank title", post_issue({**issue_body, "title": "   "}) == 400)
    check("manual issue rejects an unknown severity",
          post_issue({**issue_body, "severity": "blocker"}) == 400)
    check("manual issue rejects an environment of another tenant",
          post_issue({**issue_body, "environmentId": str(uuid.uuid4())}) == 404)
    check("member without alerts cannot enter issues", post_issue(issue_body, product_token) == 403)
    check("alerts-only member may enter issues (stopped by validation, not permission)",
          post_issue({**issue_body, "title": ""}, alert_token) == 400)

    # 夹具只建一次。之后每轮按标题找到它，先重新打开，再继续下面的检查。
    issue = next((a for a in alerts_listed() if a.get("title") == ISSUE_TITLE and a.get("source") == "manual"), None)
    first_time = issue is None
    if first_time:
        _FakeBotHandler.requests.clear()
        _, issue = call("POST", f"{base}/alerts", issue_body, token=admin_token, expect=None)
        check("entering an issue pushes it once to every channel subscribed to manual issues",
              paths_since() == ["dingtalk", "feishu", "wecom"], str(paths_since()))
        check("the pushed message names the people to notify", mentions(list(notified.values())))
    issue_id = issue.get("id") if isinstance(issue, dict) else None
    if issue_id and not first_time:
        call("PATCH", f"{base}/alerts/{issue_id}", {"status": "open"}, token=admin_token, expect=None)

    row = next((a for a in alerts_listed() if a.get("id") == issue_id), {})
    check("manual issue appears in the list as an open issue with source manual",
          bool(row) and row.get("source") == "manual" and row.get("status") == "open", str(row)[:160])
    check("manual issue records who entered it and who is notified",
          bool(row) and row.get("createdByName") == admin["user"]["name"]
          and {u.get("id"): u.get("name") for u in row.get("notifiedUsers") or []} == notified,
          str(row)[:200])
    check("manual issue carries its environment and no monitor",
          bool(row) and row.get("environmentId") == test_env["id"]
          and row.get("environmentName") == test_env["name"] and not row.get("monitorId"),
          str(row)[:160])
    history = row.get("deliveries") or []
    check("alert list carries the alert's delivery history",
          bool(history) and all(d.get("alertId") == issue_id for d in history), str(history)[:160])

    def resend(body: dict | None = None, token: str | None = None):
        return call("POST", f"{base}/alerts/{issue_id}/resend", body if body is not None else {},
                    token=token or admin_token, expect=None)

    _FakeBotHandler.requests.clear()
    _, res = resend()
    rows = res.get("deliveries") if isinstance(res, dict) else None
    check("resend pushes again to every channel subscribed to manual issues",
          paths_since() == ["dingtalk", "feishu", "wecom"]
          and isinstance(rows, list) and len(rows) == 3
          and all(d.get("event") == "manual" and d.get("status") == "sent" for d in rows),
          f"{paths_since()} {str(res)[:160]}")
    check("the resent message names the people to notify", mentions(list(notified.values())))
    row = next((a for a in alerts_listed() if a.get("id") == issue_id), {})
    check("resends are recorded in the alert's history",
          sum(d.get("event") == "manual" for d in row.get("deliveries") or []) >= 3,
          str(row.get("deliveries"))[:160])

    call("PATCH", f"{base}/alert-channels/{wecom_id}", {"enabled": False}, token=admin_token, expect=None)
    _FakeBotHandler.requests.clear()
    resend({"channelIds": [wecom_id, feishu_id]})
    check("resend keeps only the channels that are enabled and subscribed",
          paths_since() == ["feishu"], str(paths_since()))
    call("PATCH", f"{base}/alert-channels/{wecom_id}", {"enabled": True}, token=admin_token, expect=None)
    status, _ = resend({"channelIds": [str(uuid.uuid4())]})
    check("resend rejects a channel that belongs to another tenant", status == 400, f"status {status}")
    status, _ = resend({"channelIds": []})
    check("resend rejects an explicit empty channel list", status == 400, f"status {status}")
    status, _ = resend(token=product_token)
    check("member without alerts cannot resend", status == 403, f"status {status}")

    def set_status(next_status: str) -> dict:
        _, out = call("PATCH", f"{base}/alerts/{issue_id}", {"status": next_status},
                      token=admin_token, expect=None)
        return out if isinstance(out, dict) else {}

    _FakeBotHandler.requests.clear()
    out = set_status("resolved")
    pushed = out.get("pushed") or []
    check("resolving pushes the status change to the channels subscribed to it",
          paths_since() == ["feishu", "wecom"] and len(pushed) == 2
          and all(d.get("event") == "status" and d.get("status") == "sent" for d in pushed),
          f"{paths_since()} {str(out)[:160]}")
    check("status response returns the alert with its delivery history",
          out.get("status") == "resolved" and isinstance(out.get("deliveries"), list)
          and len(out["deliveries"]) >= len(pushed), str(out)[:160])
    out = set_status("resolved")
    check("an unchanged status pushes nothing", out.get("pushed") == [], str(out.get("pushed")))
    _FakeBotHandler.requests.clear()
    out = set_status("open")
    check("reopening pushes the status change",
          paths_since() == ["feishu", "wecom"] and len(out.get("pushed") or []) == 2, str(out)[:160])
    set_status("resolved")  # 每轮结束留在「已解决」，不影响未处理告警数

    # --- 监控告警联动 ---
    _, monitors = call("GET", f"{base}/monitors", token=admin_token)
    probe = next((m for m in monitors if m["name"] == PROBE_NAME), None)
    if probe is None:
        _, probe = call(
            "POST", f"{base}/monitors",
            {"name": PROBE_NAME, "url": "http://127.0.0.1:9/health", "environmentId": test_env["id"]},
            token=admin_token, expect=None,
        )
    probe_id = probe.get("id") if isinstance(probe, dict) else None
    # 上一轮中途失败会留下未处理的探针告警，或指向失效地址的探针：先让它恢复，把它们自动解决。
    call("PATCH", f"{base}/monitors/{probe_id}", {"url": f"{API}/api/health"}, token=admin_token, expect=None)
    call("POST", f"{base}/monitors/{probe_id}/check", {}, token=admin_token, expect=None)
    call("PATCH", f"{base}/monitors/{probe_id}", {"url": "http://127.0.0.1:9/health"}, token=admin_token, expect=None)

    _FakeBotHandler.requests.clear()
    _, checked = call("POST", f"{base}/monitors/{probe_id}/check", {}, token=admin_token, expect=None)
    check("probe monitor reports down",
          isinstance(checked, dict) and checked.get("status") == "down", str(checked)[:120])
    open_probe = [a for a in alerts_listed() if a.get("monitorId") == probe_id and a.get("status") == "open"]
    check("a failed check creates exactly one new alert", len(open_probe) == 1, str(len(open_probe)))
    alert = open_probe[0] if open_probe else {}
    check("monitor alert reports source monitor and the monitor's environment",
          alert.get("source") == "monitor" and alert.get("monitorName") == PROBE_NAME
          and alert.get("environmentId") == test_env["id"]
          and alert.get("environmentName") == test_env["name"]
          and alert.get("createdByName") is None, str(alert)[:200])
    check("a new monitor alert is pushed once to every channel subscribed to monitor alerts",
          paths_since() == ["dingtalk", "feishu", "wecom"], str(paths_since()))
    check("the monitor alert lists its deliveries",
          [d.get("event") for d in alert.get("deliveries") or []].count("monitor") >= 3
          and all(d.get("status") == "sent" for d in alert.get("deliveries") or []),
          str(alert.get("deliveries"))[:160])

    # --- 监控一直失败时不重复生成、不重复推送 ---
    _FakeBotHandler.requests.clear()
    call("POST", f"{base}/monitors/{probe_id}/check", {}, token=admin_token, expect=None)
    check("a second failed check pushes nothing", paths_since() == [], str(paths_since()))
    open_probe = [a for a in alerts_listed() if a.get("monitorId") == probe_id and a.get("status") == "open"]
    check("a second failed check creates no second alert", len(open_probe) == 1, str(len(open_probe)))

    call("PATCH", f"{base}/monitors/{probe_id}", {"url": f"{API}/api/health"}, token=admin_token, expect=None)
    _FakeBotHandler.requests.clear()
    _, checked = call("POST", f"{base}/monitors/{probe_id}/check", {}, token=admin_token, expect=None)
    check("probe monitor recovers",
          isinstance(checked, dict) and checked.get("status") == "up", str(checked)[:120])
    check("a recovered monitor pushes the status change",
          paths_since() == ["feishu", "wecom"], str(paths_since()))
    check("a recovered monitor resolves its open alerts",
          not any(a.get("monitorId") == probe_id and a.get("status") == "open" for a in alerts_listed()))

    # --- 关联了监控的手工问题不参与监控告警的去重，也不会被监控恢复自动解决 ---
    linked_title = "冒烟：关联探针的手工问题"
    linked = next((a for a in alerts_listed() if a.get("title") == linked_title and a.get("source") == "manual"), None)
    if linked:
        call("PATCH", f"{base}/alerts/{linked['id']}", {"status": "open"}, token=admin_token, expect=None)
    else:
        _, linked = call("POST", f"{base}/alerts", {"title": linked_title, "monitorId": probe_id, "push": False},
                         token=admin_token, expect=None)
    linked_id = linked.get("id") if isinstance(linked, dict) else None
    call("PATCH", f"{base}/monitors/{probe_id}", {"url": "http://127.0.0.1:9/health"}, token=admin_token, expect=None)
    call("POST", f"{base}/monitors/{probe_id}/check", {}, token=admin_token, expect=None)
    check("a failed check still raises a monitor alert when a manual issue is linked to the monitor",
          any(a.get("monitorId") == probe_id and a.get("source") == "monitor" and a.get("status") == "open"
              for a in alerts_listed()))
    call("PATCH", f"{base}/monitors/{probe_id}", {"url": f"{API}/api/health"}, token=admin_token, expect=None)
    call("POST", f"{base}/monitors/{probe_id}/check", {}, token=admin_token, expect=None)
    check("a recovered monitor leaves a linked manual issue open",
          bool(linked_id) and any(a.get("id") == linked_id and a.get("status") == "open" for a in alerts_listed()))
    call("PATCH", f"{base}/alerts/{linked_id}", {"status": "resolved"}, token=admin_token, expect=None)
    call("PATCH", f"{base}/monitors/{probe_id}", {"url": "http://127.0.0.1:9/health"}, token=admin_token, expect=None)

    # --- 环境的操作系统 ---
    throwaway_name = "冒烟系统类型校验"

    def envs_now() -> list[dict]:
        _, out = call("GET", f"{base}/environments", token=admin_token, expect=None)
        return out if isinstance(out, list) else []

    for leftover in [e for e in envs_now() if e["name"].startswith(throwaway_name)]:
        call("DELETE", f"{base}/environments/{leftover['id']}", token=admin_token, expect=None)  # 上一轮中途失败留下的
    status, created = call("POST", f"{base}/environments", {"name": throwaway_name},
                           token=admin_token, expect=None)
    check("a new environment defaults to linux",
          status == 200 and isinstance(created, dict) and created.get("osType") == "linux", str(created)[:120])
    throwaway_id = created.get("id") if isinstance(created, dict) else None
    status, bad = call("POST", f"{base}/environments", {"name": f"{throwaway_name}（非法值）", "osType": "mac"},
                       token=admin_token, expect=None)
    check("creating an environment rejects an unknown operating system", status == 400, f"status {status}")
    if status == 200:  # 校验还没生效时（先写检查的那一步），别把它留在库里
        call("DELETE", f"{base}/environments/{bad['id']}", token=admin_token, expect=None)
    status, _ = call("PATCH", f"{base}/environments/{throwaway_id}", {"osType": "mac"},
                     token=admin_token, expect=None)
    check("updating an environment rejects an unknown operating system", status == 400, f"status {status}")
    status, _ = call("PATCH", f"{base}/environments/{throwaway_id}", {"osType": "windows"},
                     token=admin_token, expect=None)
    check("operating system can be switched to windows",
          status == 200 and next(
              (e.get("osType") for e in envs_now() if e.get("id") == throwaway_id), None) == "windows")
    status, _ = call("PATCH", f"{base}/environments/{throwaway_id}", {"name": throwaway_name},
                     token=admin_token, expect=None)
    check("an update without osType keeps the operating system",
          status == 200 and next(
              (e.get("osType") for e in envs_now() if e.get("id") == throwaway_id), None) == "windows")
    status, _ = call("DELETE", f"{base}/environments/{throwaway_id}", token=admin_token, expect=None)
    check("throwaway environment removed",
          status == 200 and not any(e.get("id") == throwaway_id for e in envs_now()))


def main() -> int:
    print(f"\nTransOnce smoke test → {API}\n")

    print("[health]")
    _, health = call("GET", "/api/health")
    check("health endpoint ok", health.get("ok") is True)
    check("agent provider reported", bool(health.get("provider")))

    print("\n[bootstrap fixtures]")
    admin = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    check("admin login", bool(admin.get("token")))
    check("admin is super admin", admin["user"].get("isSuperAdmin") is True)
    tenant_id, product_token, dev_token = bootstrap(TENANT_SLUG)
    product = {"token": product_token}
    ensure_delivery_fixtures(tenant_id, admin["token"])
    _, me = call("GET", "/api/auth/me", token=product["token"])
    memberships = me.get("memberships") or []
    check("smoke tenant ready", any(m["tenant"]["id"] == tenant_id for m in memberships))
    check("product has one active membership", len(memberships) == 1)
    membership = memberships[0]
    perms = membership.get("permissions") or []
    check("membership exposes top-level permissions", len(perms) > 0)
    check("membership exposes memberCount", int(membership.get("memberCount") or 0) >= 3)
    check("product can access requirements", "requirements" in perms)
    check("product cannot deploy", "deployment" not in perms)
    check("product cannot manage environments", "environments" not in perms)

    # 只跑告警通知一节（改动相关代码后的快速回归），仍然先完成启动和夹具准备。
    if os.getenv("SMOKE_ONLY") == "alerts":
        section_alert_notifications(tenant_id, admin, product_token, dev_token)
        return _summary()

    print("\n[auth & tenancy]")
    _, tenants = call("GET", "/api/tenants", token=product["token"])
    check("tenant list returns memberships", any(t["tenant"]["id"] == tenant_id for t in tenants["items"]))
    fake = str(uuid.uuid4())
    status, _ = call("GET", f"/api/tenants/{fake}/dashboard", token=product["token"], expect=None)
    check("unknown tenant is rejected", status in (403, 404), f"status {status}")
    # Tenant creation is super-admin-only; the call is rejected, nothing is created.
    status, _ = call("POST", "/api/tenants", {"name": "smoke-禁用创建"}, token=product["token"], expect=None)
    check("non-super-admin cannot create tenants", status == 403, f"status {status}")

    print("\n[join request flow]")
    join_token = _ensure_user(JOIN_EMAIL, "冒烟加入", JOIN_PASSWORD)
    _, found = call("GET", "/api/tenants/discover", token=join_token)
    entry = next((i for i in found["items"] if i["tenant"]["slug"] == TENANT_SLUG), None)
    check("smoke tenant discoverable", entry is not None)
    if entry:
        if entry["myRequestStatus"] != "pending":  # a pending request may remain from a previous run
            _, req = call(
                "POST", f"/api/tenants/{tenant_id}/join-requests",
                {"message": "冒烟加入申请"}, token=join_token,
            )
            check("join request submitted", req.get("status") == "pending")
        _, reqs = call("GET", f"/api/tenants/{tenant_id}/join-requests", token=admin["token"])
        pending = next(
            (r for r in reqs if r["email"] == JOIN_EMAIL and r["status"] == "pending"), None,
        )
        check("join request visible to approver", pending is not None)
        if pending:
            call("POST", f"/api/tenants/{tenant_id}/join-requests/{pending['id']}/reject", {}, token=admin["token"])
            _, found2 = call("GET", "/api/tenants/discover", token=join_token)
            after = next((i for i in found2["items"] if i["tenant"]["slug"] == TENANT_SLUG), None)
            check("rejection surfaced as myRequestStatus", (after or {}).get("myRequestStatus") == "rejected")
            # A rejection is a notice, not a dead end: the user can re-apply.
            _, reapplied = call(
                "POST", f"/api/tenants/{tenant_id}/join-requests",
                {"message": "冒烟再次申请"}, token=join_token,
            )
            check("re-apply after rejection allowed", reapplied.get("status") == "pending")
            # leave one pending request behind so re-runs exercise the same path

    print("\n[dashboard & requirements]")
    _, dash = call("GET", f"/api/tenants/{tenant_id}/dashboard", token=admin["token"])
    counts = dash.get("counts") or {}
    check("dashboard returns counts", isinstance(counts.get("requirements"), int))
    _, requirements = call("GET", f"/api/tenants/{tenant_id}/requirements", token=admin["token"])
    check("fixture requirements exist", len(requirements) > 0)
    if counts.get("requirements"):
        check("dashboard counts requirements", int(counts["requirements"]) == len(requirements))
    designed = next((r for r in requirements if r.get("prototype") and r.get("architecture")), None)
    check("a designed requirement exists", designed is not None)
    if designed:
        try:
            proto = json.loads(designed["prototype"])
            check("prototype is valid JSON", isinstance(proto, dict) and bool(proto.get("summary")))
        except (TypeError, json.JSONDecodeError):
            check("prototype is valid JSON", False, "JSON.parse failed")
        arch = designed.get("architecture") or {}
        check("architecture has components", bool(arch.get("components")))

    print("\n[permission boundaries]")
    for path, label in [
        (f"/api/tenants/{tenant_id}/environments", "environments"),
        (f"/api/tenants/{tenant_id}/alerts", "alerts"),
        (f"/api/tenants/{tenant_id}/monitors", "monitors"),
        (f"/api/tenants/{tenant_id}/pipelines", "pipelines"),
    ]:
        status, _ = call("GET", path, token=product["token"], expect=None)
        check(f"product blocked from {label}", status == 403, f"status {status}")

    print("\n[environments & secrets]")
    _, envs = call("GET", f"/api/tenants/{tenant_id}/environments", token=admin["token"])
    check("environments listed", len(envs) > 0)
    leaked = [e for e in envs if e.get("password")]
    check("environment list never returns plaintext password", not leaked)
    masked = [e for e in envs if e.get("passwordMasked")]
    check("environment passwords are masked", len(masked) > 0)
    revealable = next((e for e in envs if e.get("hasPassword")), None)
    if revealable:
        _, reveal = call(
            "POST", f"/api/tenants/{tenant_id}/environments/{revealable['id']}/reveal",
            {}, token=admin["token"],
        )
        check("admin can reveal secret", bool(reveal.get("password")))
        status, _ = call(
            "POST", f"/api/tenants/{tenant_id}/environments/{revealable['id']}/reveal",
            {}, token=product["token"], expect=None,
        )
        check("product cannot reveal secret", status == 403, f"status {status}")

    print("\n[production deploy gate]")
    _, artifacts = call("GET", f"/api/tenants/{tenant_id}/artifacts", token=admin["token"])
    _, prod_envs = call("GET", f"/api/tenants/{tenant_id}/environments", token=admin["token"])
    production = next((e for e in prod_envs if e.get("kind") == "production"), None)
    check("production environment exists", production is not None)
    if artifacts and production:
        status, _ = call(
            "POST", f"/api/tenants/{tenant_id}/artifacts/{artifacts[0]['id']}/release",
            {"environmentId": production["id"], "notes": "smoke test gate"},
            token=product["token"], expect=None,
        )
        check("product cannot deploy to production", status == 403, f"status {status}")

    print("\n[monitoring]")
    _, monitors = call("GET", f"/api/tenants/{tenant_id}/monitors", token=admin["token"])
    check("monitors listed", len(monitors) > 0)
    if monitors:
        _, checked = call("POST", f"/api/tenants/{tenant_id}/monitors/{monitors[0]['id']}/check", {}, token=admin["token"])
        check("monitor check returns status", checked.get("status") in ("up", "down", "unknown"), str(checked)[:120])

    section_alert_notifications(tenant_id, admin, product_token, dev_token)

    print("\n[agent chat]")
    _, chat = call(
        "POST", f"/api/tenants/{tenant_id}/chat",
        {"content": "你好，请用一句话介绍你可以帮我做什么。"},
        token=product["token"], timeout=300,
    )
    conversation = chat.get("conversation") or {}
    check("chat creates conversation", bool(conversation.get("id")))
    check("chat returns assistant reply", bool((chat.get("assistantMessage") or {}).get("content")))
    if conversation.get("id"):
        call("DELETE", f"/api/tenants/{tenant_id}/conversations/{conversation['id']}", token=product["token"])
        check("throwaway conversation deleted", True)

    print("\n[meeting extraction preview]")
    _, meetings = call("GET", f"/api/tenants/{tenant_id}/meetings", token=admin["token"])
    check("meetings listed", len(meetings) > 0)
    if meetings:
        _, extracted = call(
            "POST", f"/api/tenants/{tenant_id}/meetings/{meetings[0]['id']}/extract?save=false",
            {}, token=admin["token"], timeout=300,
        )
        drafts = extracted.get("requirements") or []
        check("extraction returns drafts", len(drafts) > 0)
        check("drafts have titles", all((d.get("title") or "").strip() for d in drafts))

    print("\n[code repos]")
    _, conns = call("GET", f"/api/tenants/{tenant_id}/gitlab/connections", token=admin["token"])
    check("gitlab connections listed", len(conns) >= 1)
    check("connection token only exposed as mask", all(
        not c.get("token") and (not c.get("hasToken") or bool(c.get("tokenMasked"))) for c in conns
    ))
    _, repos = call("GET", f"/api/tenants/{tenant_id}/repos", token=product["token"])
    check("repos visible to product", len(repos) > 0)
    check("repos carry per-user access state", all("myAccess" in r and "myRequest" in r for r in repos))
    # Pick a repo product has no access to for the request→approve→revoke flow.
    target = next(
        (r for r in repos if not r.get("myAccess") and not r.get("myRequest")),
        None,
    )
    _, dev_repos = call("GET", f"/api/tenants/{tenant_id}/repos", token=dev_token)
    check("dev role sees repos (menu permission)", len(dev_repos) > 0)
    status, _ = call(
        "POST", f"/api/tenants/{tenant_id}/gitlab/connections",
        {"name": "smoke", "baseUrl": "https://gitlab.invalid", "token": "t"},
        token=product["token"], expect=None,
    )
    check("product cannot link gitlab", status == 403, f"status {status}")
    pending = None
    if target:
        _, pending = call(
            "POST", f"/api/tenants/{tenant_id}/repos/{target['id']}/access-requests",
            {"role": "developer", "reason": "smoke run"}, token=product["token"],
        )
    _, reqs = call("GET", f"/api/tenants/{tenant_id}/repo-access-requests", token=admin["token"])
    check("access requests listable by approver", isinstance(reqs, list) and len(reqs) >= 1)
    if not target:
        print("  · no requestable repo for product; request flow skipped")
    if pending:
        _, approved = call(
            "POST", f"/api/tenants/{tenant_id}/repo-access-requests/{pending['id']}/approve",
            {"note": "smoke"}, token=admin["token"],
        )
        check("access request approved", approved.get("status") == "approved")
        _, repos2 = call("GET", f"/api/tenants/{tenant_id}/repos", token=product["token"])
        after = next((r for r in repos2 if r["id"] == target["id"]), None)
        check("granted role annotated on repo list", (after or {}).get("myAccess", {}).get("role") == "developer")
        # leave no state behind: revoke the throwaway grant again
        _, me_prod = call("GET", "/api/auth/me", token=product["token"])
        call("DELETE", f"/api/tenants/{tenant_id}/repos/{target['id']}/access/{me_prod['user']['id']}", token=admin["token"])
        _, repos3 = call("GET", f"/api/tenants/{tenant_id}/repos", token=product["token"])
        final = next((r for r in repos3 if r["id"] == target["id"]), None)
        check("revoked access cleared", (final or {}).get("myAccess") is None)
    fake = str(uuid.uuid4())
    status, _ = call(
        "POST", f"/api/tenants/{tenant_id}/repo-access-requests/{fake}/approve",
        {}, token=product["token"], expect=None,
    )
    check("product cannot approve access", status == 403, f"status {status}")

    print("\n[project codebase link]")
    _, projects = call("GET", f"/api/tenants/{tenant_id}/projects", token=admin["token"])
    check("projects listed", len(projects) > 0)
    if projects:
        _, systems = call("GET", f"/api/tenants/{tenant_id}/projects/{projects[0]['id']}/systems", token=admin["token"])
        system = systems[0] if systems else None
        check("systems listed", system is not None)
        if system and repos:
            linked = {c.get("repoId") for c in (system.get("codebases") or [])}
            free = next((r for r in repos if r["id"] not in linked), None)
            if free:
                _, created = call(
                    "POST", f"/api/tenants/{tenant_id}/systems/{system['id']}/codebases",
                    {"repoId": free["id"], "language": "Python"}, token=admin["token"],
                )
                check("codebase created from synced repo", created.get("repoPath") == free["path"])
                dup_status, _ = call(
                    "POST", f"/api/tenants/{tenant_id}/systems/{system['id']}/codebases",
                    {"repoId": free["id"]}, token=admin["token"], expect=None,
                )
                check("duplicate repo link rejected", dup_status == 400, f"status {dup_status}")
                call("DELETE", f"/api/tenants/{tenant_id}/codebases/{created['id']}", token=admin["token"])
            else:
                check("codebase created from synced repo", True, "all repos already linked")

    print("\n[permission catalog]")
    _, catalog = call("GET", "/api/permissions", token=admin["token"])
    items = catalog.get("items") if isinstance(catalog, dict) else catalog
    check("permission catalog available", bool(items))

    print("\n[profile self-service]")
    dev = login(DEV_EMAIL, DEV_PASSWORD)
    orig_name = dev["user"]["name"]
    # rename and restore
    _, renamed = call("PATCH", "/api/auth/me", {"name": orig_name + "（冒烟）"}, token=dev["token"])
    check("self rename applied", (renamed.get("name") or "").endswith("（冒烟）"))
    _, restored = call("PATCH", "/api/auth/me", {"name": orig_name}, token=dev["token"])
    check("self rename restored", restored.get("name") == orig_name)
    # login credentials are protected by the current password
    status, _ = call(
        "PATCH", "/api/auth/me", {"email": f"smoke-{uuid.uuid4().hex[:8]}@transonce.local"},
        token=dev["token"], expect=None,
    )
    check("email change requires current password", status == 400, f"status {status}")
    status, _ = call(
        "PATCH", "/api/auth/me", {"password": "smoke-pass-123", "currentPassword": "wrong-password"},
        token=dev["token"], expect=None,
    )
    check("wrong current password rejected", status == 400, f"status {status}")
    status, _ = call(
        "PATCH", "/api/auth/me", {"email": ADMIN_EMAIL, "currentPassword": DEV_PASSWORD},
        token=dev["token"], expect=None,
    )
    check("email already in use rejected", status == 409, f"status {status}")
    # password round-trip: change, log in with the new one, restore
    tmp_password = f"smoke-{uuid.uuid4().hex[:8]}"
    call("PATCH", "/api/auth/me", {"password": tmp_password, "currentPassword": DEV_PASSWORD}, token=dev["token"])
    status, _ = call("POST", "/api/auth/login", {"email": DEV_EMAIL, "password": tmp_password}, expect=None)
    check("login with new password", status == 200, f"status {status}")
    call("PATCH", "/api/auth/me", {"password": DEV_PASSWORD, "currentPassword": tmp_password}, token=dev["token"])
    status, _ = call("POST", "/api/auth/login", {"email": DEV_EMAIL, "password": DEV_PASSWORD}, expect=None)
    check("password restored", status == 200, f"status {status}")
    # email round-trip: change, log in with the new one, restore
    tmp_email = f"smoke-{uuid.uuid4().hex[:8]}@transonce.local"
    _, moved = call("PATCH", "/api/auth/me", {"email": tmp_email, "currentPassword": DEV_PASSWORD}, token=dev["token"])
    check("email change applied", moved.get("email") == tmp_email)
    status, _ = call("POST", "/api/auth/login", {"email": tmp_email, "password": DEV_PASSWORD}, expect=None)
    check("login with new email", status == 200, f"status {status}")
    call("PATCH", "/api/auth/me", {"email": DEV_EMAIL, "currentPassword": DEV_PASSWORD}, token=dev["token"])
    dev = login(DEV_EMAIL, DEV_PASSWORD)
    check("email restored", bool(dev.get("token")) and dev["user"]["email"] == DEV_EMAIL)

    print("\n[auth configuration]")
    # The login page reads this unauthenticated; it must agree with the stored settings.
    _, pub_cfg = call("GET", "/api/auth/config")
    check("public auth config shape", all(
        k in pub_cfg for k in ("passwordLoginEnabled", "registrationEnabled", "microsoftEnabled")
    ))
    status, _ = call("GET", "/api/auth/settings", token=dev["token"], expect=None)
    check("non-admin cannot read auth settings", status == 403, f"status {status}")
    _, orig = call("GET", "/api/auth/settings", token=admin["token"])
    check("auth settings shape", isinstance(orig.get("microsoft"), dict) and set(orig) >= {
        "passwordLoginEnabled", "registrationEnabled", "microsoft"
    })
    check("config mirrors settings", (
        pub_cfg["passwordLoginEnabled"] == orig["passwordLoginEnabled"]
        and pub_cfg["registrationEnabled"] == orig["registrationEnabled"]
    ))
    try:
        call("PUT", "/api/auth/settings", {"registrationEnabled": False}, token=admin["token"])
        status, _ = call(
            "POST", "/api/auth/register",
            {"email": f"smoke-{uuid.uuid4().hex[:8]}@transonce.local",
             "name": "注册开关", "password": "smoke-pass-123"},
            expect=None,
        )
        check("register rejected while disabled", status == 403, f"status {status}")

        call("PUT", "/api/auth/settings", {"passwordLoginEnabled": False}, token=admin["token"])
        status, _ = call("POST", "/api/auth/login",
                         {"email": DEV_EMAIL, "password": DEV_PASSWORD}, expect=None)
        check("password login rejected while disabled", status == 403, f"status {status}")
        status, _ = call("POST", "/api/auth/login",
                         {"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, expect=None)
        check("super admin keeps password login", status == 200, f"status {status}")

        # The MS client secret is write-only: only run the mutation checks when
        # no real secret is stored, so the restore below is exact.
        if not orig["microsoft"]["hasClientSecret"]:
            _, ms = call("PUT", "/api/auth/settings", {
                "microsoft": {"enabled": True, "tenantId": "common",
                              "clientId": "smoke-client-id", "clientSecret": "smoke-secret"},
            }, token=admin["token"])
            check("microsoft settings stored", (
                ms["microsoft"]["clientId"] == "smoke-client-id"
                and ms["microsoft"]["hasClientSecret"] is True
            ))
            check("microsoft secret only masked", str(ms["microsoft"].get("clientSecretMasked") or "").startswith("••••"))
            _, cfg2 = call("GET", "/api/auth/config")
            check("microsoft login advertised", cfg2["microsoftEnabled"] is True)
            _, started = call("POST", "/api/auth/microsoft/start",
                              {"redirectUri": "http://localhost:3002/login/microsoft"})
            check("microsoft authorize url built", (
                "login.microsoftonline.com/common/oauth2/v2.0/authorize" in started["url"]
                and "client_id=smoke-client-id" in started["url"]
                and "state=" in started["url"]
            ))
            status, _ = call("POST", "/api/auth/microsoft/callback",
                             {"code": "x", "state": "garbage"}, expect=None)
            check("microsoft callback rejects bad state", status == 400, f"status {status}")
            status, _ = call("PUT", "/api/auth/settings",
                             {"microsoft": {"enabled": True}}, token=dev["token"], expect=None)
            check("non-admin cannot change auth settings", status == 403, f"status {status}")
            status, _ = call("PUT", "/api/auth/settings", {
                "microsoft": {"enabled": True, "clientId": "", "clientSecret": ""},
            }, token=admin["token"], expect=None)
            check("microsoft enable requires client config", status == 400, f"status {status}")
        else:
            print("  · microsoft client already configured — skipping mutation checks")
    finally:
        restore = {
            "passwordLoginEnabled": orig["passwordLoginEnabled"],
            "registrationEnabled": orig["registrationEnabled"],
            "microsoft": {
                "enabled": orig["microsoft"]["enabled"],
                "tenantId": orig["microsoft"]["tenantId"],
                "clientId": orig["microsoft"]["clientId"],
            },
        }
        if not orig["microsoft"]["hasClientSecret"]:
            restore["microsoft"]["clientSecret"] = ""  # drop the smoke secret again
        call("PUT", "/api/auth/settings", restore, token=admin["token"])
        _, after_cfg = call("GET", "/api/auth/config")
        check("auth settings restored", (
            after_cfg["passwordLoginEnabled"] == orig["passwordLoginEnabled"]
            and after_cfg["registrationEnabled"] == orig["registrationEnabled"]
        ))

    print("\n[generic oidc login]")
    oidc_base = _start_fake_oidc()
    _, orig_all = call("GET", "/api/auth/settings", token=admin["token"])
    try:
        if not orig_all["oidc"]["hasClientSecret"]:
            _, saved = call("PUT", "/api/auth/settings", {
                "oidc": {"enabled": True, "issuerUrl": oidc_base,
                         "clientId": "smoke-oidc-client", "clientSecret": "smoke-oidc-secret",
                         "displayName": "冒烟 SSO"},
            }, token=admin["token"])
            check("oidc settings stored", (
                saved["oidc"]["issuerUrl"] == oidc_base and saved["oidc"]["hasClientSecret"] is True
            ))
            _, cfg3 = call("GET", "/api/auth/config")
            check("oidc login advertised", cfg3["oidcEnabled"] is True and cfg3["oidcDisplayName"] == "冒烟 SSO")

            # start → authorize (302 to the client redirect_uri) → extract code/state
            _, started = call("POST", "/api/auth/oidc/start",
                              {"redirectUri": "http://127.0.0.1:39998/callback"})
            check("oidc authorize url built (loopback redirect accepted)", (
                started["url"].startswith(oidc_base + "/authorize")
                and "client_id=smoke-oidc-client" in started["url"]
                and "nonce=" in started["url"]
            ))
            no_redirect = urllib.request.build_opener(_NoRedirect)
            try:
                no_redirect.open(started["url"], timeout=10)
                location = ""
            except urllib.error.HTTPError as exc:
                location = exc.headers.get("location", "")
            check("oidc provider redirected back with code+state", "code=smoke-oidc-code" in location and "state=" in location, location[:120])
            back = urllib.parse.parse_qs(urllib.parse.urlsplit(location).query)

            _, logged_in = call("POST", "/api/auth/oidc/callback",
                                {"code": back["code"][0], "state": back["state"][0]})
            check("oidc login issues a platform token", bool(logged_in.get("token")))
            check("oidc auto-registered by email", (
                logged_in["user"]["email"] == _FakeOidcHandler.EMAIL
                and logged_in["user"].get("authProvider") == "oidc"
            ))
            status, _ = call("POST", "/api/auth/oidc/callback",
                             {"code": "x", "state": "garbage"}, expect=None)
            check("oidc callback rejects bad state", status == 400, f"status {status}")
            status, _ = call("POST", "/api/auth/oidc/start",
                             {"redirectUri": "ftp://nope"}, expect=None)
            check("oidc start rejects non-http redirect", status == 400, f"status {status}")
        else:
            print("  · oidc client already configured — skipping mutation checks")
    finally:
        restore = {
            "passwordLoginEnabled": orig_all["passwordLoginEnabled"],
            "registrationEnabled": orig_all["registrationEnabled"],
            "microsoft": {
                "enabled": orig_all["microsoft"]["enabled"],
                "tenantId": orig_all["microsoft"]["tenantId"],
                "clientId": orig_all["microsoft"]["clientId"],
            },
            "oidc": {
                "enabled": orig_all["oidc"]["enabled"],
                "issuerUrl": orig_all["oidc"]["issuerUrl"],
                "clientId": orig_all["oidc"]["clientId"],
                "displayName": orig_all["oidc"].get("displayName", ""),
                "scope": orig_all["oidc"].get("scope", ""),
            },
        }
        if not orig_all["microsoft"]["hasClientSecret"]:
            restore["microsoft"]["clientSecret"] = ""
        if not orig_all["oidc"]["hasClientSecret"]:
            restore["oidc"]["clientSecret"] = ""
        call("PUT", "/api/auth/settings", restore, token=admin["token"])
        # The auto-registered smoke-oidc@ account stays as an idempotent fixture
        # (re-runs reuse it via find-or-create, mirroring the other fixtures).

    return _summary()


if __name__ == "__main__":
    try:
        sys.exit(main())
    except AssertionError as exc:
        print(f"\nAssertion failed: {exc}")
        sys.exit(1)
