"""Offline check of the LDAP login path (no network, no server).

The only step that must talk to the directory server is
ldap_client.authenticate(); everything else — filter building/escaping, UAC
disabled-bit judgment, settings save validation (required fields + secret
encryption roundtrip), find-or-create by email, token issuance, and failure
semantics (401 counts toward rate limit, 502 does not) — is exercised here
against the real DB with authenticate monkeypatched.

Usage (needs the DB, same as the backend):

    cd trans-once && python3 tests/ldap_flow.py
"""
from __future__ import annotations

import os
import sys
import uuid
from unittest.mock import patch

from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

load_dotenv()

import db  # noqa: E402
import ldap_client  # noqa: E402
import platform_settings  # noqa: E402
import routers.auth as auth_router  # noqa: E402
from fastapi import HTTPException  # noqa: E402
from types import SimpleNamespace  # noqa: E402

USER = f"ldap-flow-{uuid.uuid4().hex[:8]}"
EMAIL = f"{USER}@transonce.local"

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


class FakeRequest:
    """ldap_login 只用 request.client.host，够造一个最小桩。"""

    client = SimpleNamespace(host="127.0.0.1")


FULL_LDAP = {
    "enabled": True,
    "host": "ldap.example.com",
    "port": 389,
    "security": "plain",
    "bindDn": "cn=svc,dc=example,dc=com",
    "clientSecret": "svc-secret",
    "baseDn": "ou=staff,dc=example,dc=com",
    "userFilter": "(memberOf=cn=all,ou=staff,dc=example,dc=com)",
}


def main() -> int:
    print("[纯函数]")
    check(
        "过滤器元字符转义",
        ldap_client.escape_filter_value("a*b(c)d\\e") == "a\\2ab\\28c\\29d\\5ce",
    )
    check(
        "无用户过滤器时只按用户名匹配",
        ldap_client.build_search_filter("", "sAMAccountName", "wang")
        == "(sAMAccountName=wang)",
    )
    check(
        "有用户过滤器时 AND 合并",
        ldap_client.build_search_filter("(memberOf=cn=all,dc=x)", "sAMAccountName", "wang")
        == "(&(memberOf=cn=all,dc=x)(sAMAccountName=wang))",
    )
    check(
        "用户名注入被转义",
        ldap_client.build_search_filter("", "sAMAccountName", "a*)(objectClass=*)")
        .count("*") == 0,
    )
    check("UAC 512 正常", not ldap_client.uac_disabled(512))
    check("UAC 514 禁用", ldap_client.uac_disabled(514))
    check("UAC 66050（含禁用位）禁用", ldap_client.uac_disabled(66050))
    check("UAC 缺失不拦截", not ldap_client.uac_disabled(None))

    print("[设置校验]")
    original = platform_settings.get_auth_settings()
    try:
        try:
            platform_settings.save_auth_settings({"ldap": {"enabled": True, "host": "ldap.example.com"}})
            check("缺必填项时拒绝开启", False, "未抛 ValueError")
        except ValueError as e:
            check("缺必填项时拒绝开启", "baseDn" in str(e) and "bindDn" in str(e), str(e))

        saved = platform_settings.save_auth_settings({"ldap": dict(FULL_LDAP)})
        check("保存后 ldap 就绪", platform_settings.ldap_ready(saved))
        check("公开配置暴露 ldapEnabled", platform_settings.public_auth_config(saved)["ldapEnabled"])
        masked = platform_settings.admin_auth_settings(saved)["ldap"]
        check("管理端只见掩码", masked.get("hasClientSecret") and "svc-secret" not in str(masked))

        stored_row = db.fetch_one("SELECT value FROM platform_settings WHERE key='auth'")
        check("库里不落明文密码", "svc-secret" not in str(stored_row["value"]))

        print("[登录流程]")
        profile = {"username": USER, "email": EMAIL, "displayName": "域用户测试"}
        with patch.object(ldap_client, "authenticate", return_value=profile):
            res = auth_router.ldap_login(FakeRequest(), {"username": USER, "password": "whatever"})
        check("首次登录建号并返回会话", bool(res.get("token")) and res["user"]["email"] == EMAIL)
        row = db.fetch_one("SELECT * FROM users WHERE lower(email)=lower(%s)", (EMAIL,))
        check(
            "账号来源=ldap 且无本地密码",
            row and row["auth_provider"] == "ldap" and not row["password_hash"],
        )

        with patch.object(ldap_client, "authenticate", return_value=profile):
            res2 = auth_router.ldap_login(FakeRequest(), {"username": USER, "password": "whatever"})
        check("二次登录复用账号", bool(res2.get("token")))

        with patch.object(
            ldap_client, "authenticate",
            side_effect=ldap_client.LdapError("域账号用户名或密码错误"),
        ):
            try:
                auth_router.ldap_login(FakeRequest(), {"username": USER, "password": "bad"})
                check("密码错误返回 401", False, "未抛异常")
            except HTTPException as e:
                check("密码错误返回 401", e.status_code == 401)
        check("401 计入限流", len(auth_router._login_failures.get("127.0.0.1|" + USER, [])) == 1)

        with patch.object(
            ldap_client, "authenticate",
            side_effect=ldap_client.LdapError("LDAP 服务账号 Bind 失败", status=502),
        ):
            try:
                auth_router.ldap_login(FakeRequest(), {"username": USER, "password": "x"})
                check("服务故障返回 502", False, "未抛异常")
            except HTTPException as e:
                check("服务故障返回 502", e.status_code == 502)
        check(
            "502 不计失败次数",
            len(auth_router._login_failures.get("127.0.0.1|" + USER, [])) == 1,
        )
    finally:
        platform_settings.save_auth_settings(
            {"ldap": {**(original.get("ldap") or {}), "enabled": False}}
        )
        db.execute("DELETE FROM users WHERE lower(email)=lower(%s)", (EMAIL,))
        auth_router._login_failures.pop("127.0.0.1|" + USER, None)
        check("已还原平台设置", not platform_settings.ldap_ready(platform_settings.get_auth_settings()))

    print(f"\n通过 {passed} 项，失败 {len(failed)} 项")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
