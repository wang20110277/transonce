"""End-to-end smoke tests against a running TransOnce API.

Usage (backend must be running on :8000 and seeded):

    cd server && ../.venv/bin/python tests/smoke.py
    API_BASE=http://localhost:8000 ../.venv/bin/python tests/smoke.py

The suite is intentionally non-destructive: it only reads data, reveals a
masked secret (which writes an audit log), runs a monitor health check, and
creates/deletes one throwaway conversation. No tenant, requirement, task or
artifact is created or removed.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
import uuid

API = os.getenv("API_BASE", "http://localhost:8000").rstrip("/")
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "admin@transonce.local")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin123")
PRODUCT_EMAIL = os.getenv("PRODUCT_EMAIL", "product@transonce.local")
PRODUCT_PASSWORD = os.getenv("PRODUCT_PASSWORD", "demo123")

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

    print("\n[dashboard & requirements]")
    _, dash = call("GET", f"/api/tenants/{tenant_id}/dashboard", token=admin["token"])
    counts = dash.get("counts") or {}
    check("dashboard has counts", int(counts.get("requirements") or 0) > 0)
    check("dashboard counts tasks", int(counts.get("tasks") or 0) > 0)

    _, requirements = call("GET", f"/api/tenants/{tenant_id}/requirements", token=admin["token"])
    check("requirements listed", len(requirements) > 0)
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

    print("\n[permission catalog]")
    _, catalog = call("GET", "/api/permissions", token=admin["token"])
    items = catalog.get("items") if isinstance(catalog, dict) else catalog
    check("permission catalog available", bool(items))

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
