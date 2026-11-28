"""LDAP / Active Directory 直连登录。

流程：服务号 Bind → 按用户名在 baseDn 下搜索（叠加平台设置里的过滤器）→
检查 userAccountControl 禁用位与 mail 属性 → 以用户自己的 DN 重新 Bind 校验
密码。网络交互集中在 authenticate()，其余为纯函数，便于离线测试。
"""
from __future__ import annotations

import re
import ssl as _ssl

from ldap3 import ALL, SUBTREE, Connection, Server, Tls


class LdapError(Exception):
    """登录失败。status 区分：401 凭证问题（计入限流），502 服务/配置问题。"""

    def __init__(self, message: str, status: int = 401):
        super().__init__(message)
        self.status = status


# RFC 4515 过滤器元字符转义：用户名只作为值匹配，防 LDAP 注入。
_FILTER_ESCAPE = re.compile(r"([\\\*\(\)\x00-\x1f])")


def escape_filter_value(value: str) -> str:
    return _FILTER_ESCAPE.sub(lambda m: "\\" + format(ord(m.group(1)), "02x"), value)


def build_search_filter(user_filter: str, username_attr: str, username: str) -> str:
    """平台设置的用户过滤器（如成员组限制）与用户名条件合并为一条 AND 过滤器。"""
    cond = f"({username_attr}={escape_filter_value(username)})"
    uf = (user_filter or "").strip()
    return f"(&{uf}{cond})" if uf else cond


def uac_disabled(uac) -> bool:
    """userAccountControl 第 2 位（ACCOUNTDISABLE，514 = 512 + 2）为禁用。"""
    try:
        return (int(uac) & 0x2) != 0
    except (TypeError, ValueError):
        # 属性缺失或非数字时不据此拦截，密码正确性交给复 Bind 校验。
        return False


def authenticate(cfg: dict, username: str, password: str) -> dict:
    """校验域账号密码，成功返回 {username, email, displayName}。

    cfg 即平台设置里的 ldap 块（clientSecret 字段存 Bind 密码）。
    """
    username = (username or "").strip()
    if not username or not password:
        raise LdapError("请输入域账号用户名和密码")
    host = (cfg.get("host") or "").strip()
    port = int(cfg.get("port") or 389)
    security = (cfg.get("security") or "plain").strip().lower()
    server = Server(
        host,
        port=port,
        use_ssl=security == "ldaps",
        tls=Tls(validate=_ssl.CERT_NONE),
        connect_timeout=8,
        get_info=ALL,
    )
    conn: Connection | None = None
    try:
        conn = Connection(
            server, user=(cfg.get("bindDn") or "").strip(),
            password=cfg.get("clientSecret") or "", read_only=True,
        )
        if not conn.bind():
            raise LdapError("LDAP 服务账号 Bind 失败，请检查平台设置", status=502)
        if security == "starttls" and not conn.start_tls():
            raise LdapError("LDAP StartTLS 协商失败", status=502)
        search_filter = build_search_filter(
            cfg.get("userFilter") or "", cfg.get("usernameAttr") or "sAMAccountName", username,
        )
        conn.search(
            cfg.get("baseDn") or "", search_filter, SUBTREE,
            attributes=["mail", "displayName", "userAccountControl"],
        )
        if not conn.entries:
            raise LdapError("域账号不存在或不在允许登录的范围内")
        entry = conn.entries[0]
        attrs = entry.entry_attributes_as_dict

        def first(attr_key: str) -> str:
            values = attrs.get(attr_key) or []
            return str(values[0]).strip() if values else ""

        if uac_disabled(first("userAccountControl")):
            raise LdapError("该域账号已被禁用")
        email = first(cfg.get("mailAttr") or "mail")
        if not email:
            raise LdapError("该域账号未配置邮箱（mail 属性为空），请联系管理员补全", status=502)
        # 以用户自己的 DN 复 Bind：Bind 成功即密码正确。
        with Connection(server, user=entry.entry_dn, password=password) as user_conn:
            if not user_conn.bind():
                raise LdapError("域账号用户名或密码错误")
        return {
            "username": username,
            "email": email.lower(),
            "displayName": first(cfg.get("displayNameAttr") or "displayName") or username,
        }
    except LdapError:
        raise
    except Exception as e:  # 网络 / 协议等一切未预期错误
        raise LdapError(f"LDAP 服务不可用：{e}", status=502) from e
    finally:
        if conn is not None:
            conn.unbind()
