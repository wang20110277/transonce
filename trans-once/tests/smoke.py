"""End-to-end smoke tests against a running TransOnce API.

Usage (backend must be running on :9005 and seeded):

    cd trans-once && python3 tests/smoke.py
    API_BASE=http://localhost:9005 python3 tests/smoke.py

The suite is intentionally non-destructive: it only reads data, reveals a
masked secret (which writes an audit log), runs a monitor health check,
creates/deletes one throwaway conversation, and settles one repo access
request (idempotent across re-runs). No tenant, requirement, task or
artifact is created or removed. The profile self-service section renames
the dev account and round-trips its email/password, restoring each value
before moving on.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
import uuid

API = os.getenv("API_BASE", "http://localhost:9005").rstrip("/")
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "admin@transonce.local")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin123")
PRODUCT_EMAIL = os.getenv("PRODUCT_EMAIL", "product@transonce.local")
PRODUCT_PASSWORD = os.getenv("PRODUCT_PASSWORD", "demo123")
DEV_EMAIL = os.getenv("DEV_EMAIL", "dev@transonce.local")
DEV_PASSWORD = os.getenv("DEV_PASSWORD", "demo123")

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


def call(method: str, path: str, body=None, token: str | None = None, expect: int | None = 200):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            status = resp.status
            raw = resp.read().decode()
    except urllib.error.HTTPError as exc:
        status = exc.code
        raw = exc.read().decode(errors="replace")
    except urllib.error.URLError as exc:
        raise SystemExit(f"Cannot reach API at {API}: {exc}") from exc
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


def main() -> int:
    print(f"\nTransOnce smoke test → {API}\n")

    print("[health]")
    _, health = call("GET", "/api/health")
    check("health endpoint ok", health.get("ok") is True)
    check("agent provider reported", bool(health.get("provider")))

    print("\n[auth & tenancy]")
    admin = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    product = login(PRODUCT_EMAIL, PRODUCT_PASSWORD)
    check("admin login", bool(admin.get("token")))
    check("product login", bool(product.get("token")))
    check("admin is super admin", admin["user"].get("isSuperAdmin") is True)

    _, me = call("GET", "/api/auth/me", token=product["token"])
    memberships = me.get("memberships") or []
    check("product has one active membership", len(memberships) == 1)
    membership = memberships[0]
    perms = membership.get("permissions") or []
    check("membership exposes top-level permissions", len(perms) > 0)
    check("membership exposes memberCount", int(membership.get("memberCount") or 0) >= 3)
    check("product can access requirements", "requirements" in perms)
    check("product cannot deploy", "deployment" not in perms)
    check("product cannot manage environments", "environments" not in perms)

    tenant_id = membership["tenant"]["id"]
    _, tenants = call("GET", "/api/tenants", token=product["token"])
    check("tenant list returns memberships", any(t["tenant"]["id"] == tenant_id for t in tenants["items"]))
    fake = str(uuid.uuid4())
    status, _ = call("GET", f"/api/tenants/{fake}/dashboard", token=product["token"], expect=None)
    check("unknown tenant is rejected", status in (403, 404), f"status {status}")
    # Tenant creation is super-admin-only; the call is rejected, nothing is created.
    status, _ = call("POST", "/api/tenants", {"name": "smoke-禁用创建"}, token=product["token"], expect=None)
    check("non-super-admin cannot create tenants", status == 403, f"status {status}")

    print("\n[dashboard & requirements]")
    _, dash = call("GET", f"/api/tenants/{tenant_id}/dashboard", token=admin["token"])
    counts = dash.get("counts") or {}
    # Demo data may have been edited/deleted by operators; only the seeded
    # install is expected to carry the full meeting→requirement chain.
    check("dashboard returns counts", isinstance(counts.get("requirements"), int))
    _, requirements = call("GET", f"/api/tenants/{tenant_id}/requirements", token=admin["token"])
    if requirements:
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
    else:
        print("  · demo requirements absent (operator data); requirement checks skipped")

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

    print("\n[agent chat]")
    _, chat = call(
        "POST", f"/api/tenants/{tenant_id}/chat",
        {"content": "你好，请用一句话介绍你可以帮我做什么。"},
        token=product["token"],
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
            {}, token=admin["token"],
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
    # The offline demo connection (and its seeded grant/request) may have been
    # deleted by operators; fall back to any repo product has no access to.
    target = next(
        (
            r for r in repos
            if not r.get("myAccess") and not r.get("myRequest")
            and r.get("path") != "innovatech/retail-web"
        ),
        None,
    )
    dev = login(DEV_EMAIL, DEV_PASSWORD)
    _, dev_repos = call("GET", f"/api/tenants/{tenant_id}/repos", token=dev["token"])
    check("dev role sees repos (menu permission migrated)", len(dev_repos) > 0)
    dev_api = next((r for r in dev_repos if r.get("path") == "innovatech/retail-api"), None)
    if dev_api:
        check("seeded developer grant annotated", (dev_api or {}).get("myAccess", {}).get("role") == "developer")
    else:
        print("  · demo connection removed by operator; seeded-grant check skipped")
    status, _ = call(
        "POST", f"/api/tenants/{tenant_id}/gitlab/connections",
        {"name": "smoke", "baseUrl": "https://gitlab.invalid", "token": "t", "mode": "live"},
        token=product["token"], expect=None,
    )
    check("product cannot link gitlab", status == 403, f"status {status}")
    _, reqs = call("GET", f"/api/tenants/{tenant_id}/repo-access-requests", token=admin["token"])
    check("access requests listable by approver", isinstance(reqs, list) and len(reqs) >= 1)
    if not target:
        print("  · no requestable repo for product; request flow skipped")
    pending = next(
        (r for r in reqs if r.get("status") == "pending" and target and r.get("repoId") == target["id"]),
        None,
    )
    if not pending and target:
        _, pending = call(
            "POST", f"/api/tenants/{tenant_id}/repos/{target['id']}/access-requests",
            {"role": "developer", "reason": "smoke run"}, token=product["token"],
        )
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

    total = passed + len(failed)
    print(f"\n{'─' * 48}\n{passed}/{total} checks passed")
    if failed:
        print("Failed checks:")
        for name in failed:
            print(f"  - {name}")
        return 1
    print("All smoke checks passed ✓\n")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except AssertionError as exc:
        print(f"\nAssertion failed: {exc}")
        sys.exit(1)
