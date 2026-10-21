"""FastAPI dependencies: bearer auth, tenant context and RBAC checks."""
from dataclasses import dataclass, field

from fastapi import Header, HTTPException
from psycopg2.extras import Json

import db
from security import decode_token


@dataclass
class TenantContext:
    tenant: dict
    user: dict
    role: dict | None = None
    membership: dict | None = None
    is_tenant_admin: bool = False
    is_super_admin: bool = False
    permissions: list[str] = field(default_factory=list)

    def has(self, permission: str) -> bool:
        return (
            self.is_super_admin
            or self.is_tenant_admin
            or permission in self.permissions
        )

    def require(self, permission: str) -> None:
        if not self.has(permission):
            raise HTTPException(403, f"缺少权限: {permission}")


def get_current_user(authorization: str | None = Header(default=None)) -> dict:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "未登录")
    payload = decode_token(authorization.split(" ", 1)[1].strip())
    if not payload:
        raise HTTPException(401, "登录已过期，请重新登录")
    user = db.fetch_one("SELECT * FROM users WHERE id = %s", (payload["sub"],))
    if not user:
        raise HTTPException(401, "用户不存在")
    if user.get("status") == "disabled":
        raise HTTPException(403, "账号已被禁用")
    return user


def load_tenant_context(user: dict, tenant_id: str, permission: str | None = None) -> TenantContext:
    tenant = db.fetch_one("SELECT * FROM tenants WHERE id = %s", (tenant_id,))
    if not tenant or tenant.get("status") == "archived":
        raise HTTPException(404, "租户不存在")

    membership = db.fetch_one(
        "SELECT * FROM tenant_members WHERE tenant_id = %s AND user_id = %s",
        (tenant_id, user["id"]),
    )
    is_super = bool(user.get("is_super_admin"))
    is_admin = is_super or bool(membership and membership.get("is_tenant_admin"))

    if not is_super and (not membership or membership.get("status") != "active"):
        raise HTTPException(403, "您不是该租户的有效成员")

    role = None
    permissions: list[str] = []
    if membership and membership.get("role_id"):
        role = db.fetch_one("SELECT * FROM roles WHERE id = %s", (membership["role_id"],))
        if role:
            permissions = list(role.get("permissions") or [])

    ctx = TenantContext(
        tenant=tenant,
        user=user,
        role=role,
        membership=membership,
        is_tenant_admin=is_admin,
        is_super_admin=is_super,
        permissions=permissions,
    )
    if permission:
        ctx.require(permission)
    return ctx


def log_activity(
    ctx: TenantContext | None,
    type_: str,
    payload: dict | None = None,
    actor_kind: str = "human",
    actor_id: str | None = None,
    tenant_id: str | None = None,
    project_id: str | None = None,
) -> None:
    user_id = ctx.user["id"] if ctx else None
    if actor_id is None:
        actor_id = (ctx.user.get("name") if ctx and actor_kind == "human" else "system") or "system"
    db.execute(
        """INSERT INTO activity_events
           (tenant_id, project_id, actor_kind, actor_id, actor_user_id, type, payload)
           VALUES (%s, %s, %s, %s, %s, %s, %s)""",
        (
            tenant_id or (ctx.tenant["id"] if ctx else None),
            project_id,
            actor_kind,
            actor_id,
            user_id,
            type_,
            Json(payload or {}),
        ),
    )
