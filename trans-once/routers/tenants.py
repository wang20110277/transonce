"""Tenant lifecycle, membership, join requests, roles, agents and dashboard."""
import re
from fastapi import APIRouter, Body, Depends, HTTPException, Query
from psycopg2.extras import Json

import db
import orchestration
import serializers
from config import DEFAULT_ROLE, PERMISSIONS, ROLE_PRESETS
from deps import TenantContext, get_current_user, load_tenant_context, log_activity
from security import hash_password


router = APIRouter(prefix="/api", tags=["tenants"])


def _slugify(name: str) -> str:
    base = re.sub(r"[^a-z0-9\u4e00-\u9fff]+", "-", name.lower()).strip("-")[:24] or "tenant"
    slug = base
    i = 1
    while db.fetch_one("SELECT id FROM tenants WHERE slug=%s", (slug,)):
        i += 1
        slug = f"{base}-{i}"
    return slug


def _create_roles(tenant_id: str) -> dict[str, dict]:
    out = {}
    for preset in ROLE_PRESETS:
        row = db.execute_returning(
            """INSERT INTO roles (tenant_id, name, description, permissions, is_system)
               VALUES (%s, %s, %s, %s, TRUE) RETURNING *""",
            (tenant_id, preset["name"], preset["description"], Json(preset["permissions"])),
        )
        out[preset["name"]] = row
    return out


def _ctx_for(tenant: dict, user: dict, role: dict | None, is_admin: bool) -> TenantContext:
    return TenantContext(
        tenant=tenant, user=user, role=role, membership=None,
        is_tenant_admin=is_admin or bool(user.get("is_super_admin")),
        is_super_admin=bool(user.get("is_super_admin")),
        permissions=list((role or {}).get("permissions") or []),
    )


def _guard_admin_role(ctx: TenantContext, role: dict | None) -> None:
    """`member.manage` must not be able to hand out the tenant-admin role."""
    if role and role.get("name") == "租户管理员" and not ctx.is_tenant_admin:
        raise HTTPException(403, "只有租户管理员可以分配租户管理员角色")


def _ensure_agent_for(tenant: dict, user: dict, role: dict | None) -> dict:
    existing = db.fetch_one(
        "SELECT * FROM agents WHERE tenant_id=%s AND owner_user_id=%s", (tenant["id"], user["id"])
    )
    if existing:
        return existing
    ctx = _ctx_for(tenant, user, role, False)
    return orchestration.ensure_personal_agent(ctx)


def _summary(tenant: dict, user: dict) -> dict:
    membership = db.fetch_one(
        "SELECT * FROM tenant_members WHERE tenant_id=%s AND user_id=%s", (tenant["id"], user["id"])
    )
    role = None
    if membership and membership.get("role_id"):
        role = db.fetch_one("SELECT * FROM roles WHERE id=%s", (membership["role_id"],))
    is_admin = bool(user.get("is_super_admin")) or bool(membership and membership.get("is_tenant_admin"))
    agent = db.fetch_one(
        "SELECT * FROM agents WHERE tenant_id=%s AND owner_user_id=%s", (tenant["id"], user["id"])
    )
    member_count = db.fetch_one(
        "SELECT count(*) AS c FROM tenant_members WHERE tenant_id=%s AND status='active'", (tenant["id"],)
    )["c"]
    return {
        "tenant": serializers.tenant(tenant),
        "role": serializers.role(role) if role else None,
        "isTenantAdmin": is_admin,
        "membershipStatus": membership.get("status") if membership else None,
        "memberCount": member_count,
        "agent": serializers.agent(agent) if agent else None,
        "permissions": list((role or {}).get("permissions") or []),
    }


# --- discovery / listing ------------------------------------------------

@router.get("/permissions")
def permissions(_: dict = Depends(get_current_user)):
    return PERMISSIONS


@router.get("/tenants")
def my_tenants(user: dict = Depends(get_current_user)):
    items = []
    if user.get("is_super_admin"):
        tenants = db.fetch_all("SELECT * FROM tenants WHERE status='active' ORDER BY created_at")
        for t in tenants:
            summary = _summary(t, user)
            summary["isTenantAdmin"] = True
            items.append(summary)
    else:
        rows = db.fetch_all(
            """SELECT t.* FROM tenants t
               JOIN tenant_members m ON m.tenant_id=t.id
               WHERE m.user_id=%s AND m.status='active' AND t.status='active'
               ORDER BY t.name""",
            (user["id"],),
        )
        for t in rows:
            items.append(_summary(t, user))
    return {"items": items}


@router.get("/tenants/discover")
def discover(q: str | None = Query(default=None), user: dict = Depends(get_current_user)):
    args: list = []
    where = "WHERE t.status='active'"
    if q:
        where += " AND (t.name ILIKE %s OR t.description ILIKE %s)"
        args += [f"%{q}%", f"%{q}%"]
    rows = db.fetch_all(f"SELECT t.* FROM tenants t {where} ORDER BY t.created_at DESC LIMIT 100", tuple(args))
    items = []
    for t in rows:
        membership = db.fetch_one(
            "SELECT * FROM tenant_members WHERE tenant_id=%s AND user_id=%s", (t["id"], user["id"])
        )
        if membership and membership.get("status") == "active":
            continue
        req = db.fetch_one(
            "SELECT status FROM tenant_join_requests WHERE tenant_id=%s AND user_id=%s ORDER BY created_at DESC LIMIT 1",
            (t["id"], user["id"]),
        )
        count = db.fetch_one(
            "SELECT count(*) AS c FROM tenant_members WHERE tenant_id=%s AND status='active'", (t["id"],)
        )["c"]
        items.append({
            "tenant": serializers.tenant(t),
            "memberCount": count,
            "myRequestStatus": req["status"] if req else None,
        })
    return {"items": items}


@router.post("/tenants")
def create_tenant(body: dict = Body(...), user: dict = Depends(get_current_user)):
    if not user.get("is_super_admin"):
        raise HTTPException(403, "只有超级管理员可以创建租户")
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "请输入租户名称")
    tenant = db.execute_returning(
        """INSERT INTO tenants (name, slug, description, logo, join_policy, created_by)
           VALUES (%s, %s, %s, %s, %s, %s) RETURNING *""",
        (
            name, _slugify(body.get("slug") or name),
            body.get("description"), body.get("logo"),
            body.get("joinPolicy") or "approval", user["id"],
        ),
    )
    roles = _create_roles(str(tenant["id"]))
    admin_role = roles["租户管理员"]
    db.execute(
        """INSERT INTO tenant_members (tenant_id, user_id, role_id, status, is_tenant_admin, joined_at)
           VALUES (%s, %s, %s, 'active', TRUE, now())""",
        (tenant["id"], user["id"], admin_role["id"]),
    )
    _ensure_agent_for(tenant, user, admin_role)
    log_activity(
        _ctx_for(tenant, user, admin_role, True), "tenant.created",
        {"tenant": name}, tenant_id=str(tenant["id"]),
    )
    return _summary(tenant, user)


# --- tenant detail ------------------------------------------------------

@router.get("/tenants/{tenant_id}")
def tenant_detail(tenant_id: str, user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id)
    summary = _summary(ctx.tenant, user)
    # Email addresses and other members' agent prompts are team-admin data.
    can_team = ctx.has("team") or ctx.has("member.manage")
    can_agent_admin = ctx.has("agent.manage")

    member_rows = db.fetch_all(
        """SELECT m.*, u.name, u.email, u.avatar, u.is_super_admin, r.name AS role_name, a.id AS agent_id
           FROM tenant_members m
           JOIN users u ON u.id=m.user_id
           LEFT JOIN roles r ON r.id=m.role_id
           LEFT JOIN agents a ON a.tenant_id=m.tenant_id AND a.owner_user_id=m.user_id
           WHERE m.tenant_id=%s ORDER BY m.created_at""",
        (tenant_id,),
    )
    role_rows = db.fetch_all("SELECT * FROM roles WHERE tenant_id=%s ORDER BY created_at", (tenant_id,))
    agent_rows = db.fetch_all(
        """SELECT a.*, u.name AS owner_name FROM agents a
           LEFT JOIN users u ON u.id=a.owner_user_id
           WHERE a.tenant_id=%s ORDER BY a.created_at""",
        (tenant_id,),
    )
    join_rows = []
    if ctx.has("member.manage") or ctx.is_tenant_admin:
        join_rows = db.fetch_all(
            """SELECT j.*, u.name, u.email FROM tenant_join_requests j
               JOIN users u ON u.id=j.user_id
               WHERE j.tenant_id=%s AND j.status='pending' ORDER BY j.created_at""",
            (tenant_id,),
        )

    summary.update({
        "members": [serializers.member(m, include_email=can_team) for m in member_rows],
        "roles": [serializers.role(r) for r in role_rows],
        "agents": [
            serializers.agent(
                a,
                include_prompt=can_agent_admin or a.get("owner_user_id") == user["id"],
            )
            for a in agent_rows
        ],
        "joinRequests": [serializers.join_request(j) for j in join_rows],
        "myAgent": serializers.agent(
            _ensure_agent_for(ctx.tenant, user, ctx.role), include_prompt=True
        ),
    })
    return summary


# --- roles --------------------------------------------------------------

@router.get("/tenants/{tenant_id}/roles")
def list_roles(tenant_id: str, user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id)
    if not (ctx.has("team") or ctx.has("role.manage")):
        raise HTTPException(403, "缺少权限: team")
    rows = db.fetch_all("SELECT * FROM roles WHERE tenant_id=%s ORDER BY created_at", (tenant_id,))
    return [serializers.role(r) for r in rows]


@router.post("/tenants/{tenant_id}/roles")
def create_role(tenant_id: str, body: dict = Body(...), user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id, "role.manage")
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "请输入角色名称")
    if db.fetch_one("SELECT id FROM roles WHERE tenant_id=%s AND name=%s", (tenant_id, name)):
        raise HTTPException(409, "角色名称已存在")
    from psycopg2.extras import Json
    row = db.execute_returning(
        """INSERT INTO roles (tenant_id, name, description, permissions)
           VALUES (%s, %s, %s, %s) RETURNING *""",
        (tenant_id, name, body.get("description"), Json(body.get("permissions") or [])),
    )
    log_activity(ctx, "role.created", {"role": name})
    return serializers.role(row)


@router.patch("/tenants/{tenant_id}/roles/{role_id}")
def update_role(tenant_id: str, role_id: str, body: dict = Body(...), user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id, "role.manage")
    role = db.fetch_one("SELECT * FROM roles WHERE id=%s AND tenant_id=%s", (role_id, tenant_id))
    if not role:
        raise HTTPException(404, "角色不存在")
    from psycopg2.extras import Json
    row = db.execute_returning(
        """UPDATE roles SET name=%s, description=%s, permissions=%s WHERE id=%s RETURNING *""",
        (
            body.get("name") or role["name"],
            body.get("description", role.get("description")),
            Json(body.get("permissions") if body.get("permissions") is not None else role["permissions"]),
            role_id,
        ),
    )
    log_activity(ctx, "role.updated", {"role": row["name"]})
    return serializers.role(row)


@router.delete("/tenants/{tenant_id}/roles/{role_id}")
def delete_role(tenant_id: str, role_id: str, user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id, "role.manage")
    role = db.fetch_one("SELECT * FROM roles WHERE id=%s AND tenant_id=%s", (role_id, tenant_id))
    if not role:
        raise HTTPException(404, "角色不存在")
    if role["name"] == "租户管理员":
        raise HTTPException(400, "租户管理员角色不可删除")
    used = db.fetch_one("SELECT count(*) AS c FROM tenant_members WHERE role_id=%s", (role_id,))["c"]
    if used:
        raise HTTPException(400, f"仍有 {used} 名成员使用该角色，请先调整成员角色")
    db.execute("DELETE FROM roles WHERE id=%s", (role_id,))
    log_activity(ctx, "role.deleted", {"role": role["name"]})
    return {"ok": True}


# --- members ------------------------------------------------------------

@router.get("/tenants/{tenant_id}/members")
def list_members(tenant_id: str, user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id)
    if not (ctx.has("team") or ctx.has("member.manage")):
        raise HTTPException(403, "缺少权限: team")
    rows = db.fetch_all(
        """SELECT m.*, u.name, u.email, u.avatar, u.is_super_admin, r.name AS role_name, a.id AS agent_id
           FROM tenant_members m
           JOIN users u ON u.id=m.user_id
           LEFT JOIN roles r ON r.id=m.role_id
           LEFT JOIN agents a ON a.tenant_id=m.tenant_id AND a.owner_user_id=m.user_id
           WHERE m.tenant_id=%s ORDER BY m.created_at""",
        (tenant_id,),
    )
    return [serializers.member(r) for r in rows]


@router.post("/tenants/{tenant_id}/members")
def add_member(tenant_id: str, body: dict = Body(...), user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id, "member.manage")
    if body.get("isTenantAdmin") and not ctx.is_tenant_admin:
        raise HTTPException(403, "只有租户管理员可以授予管理员身份")
    email = (body.get("email") or "").strip().lower()
    if not email:
        raise HTTPException(400, "请输入成员邮箱")
    role = None
    if body.get("roleId"):
        role = db.fetch_one("SELECT * FROM roles WHERE id=%s AND tenant_id=%s", (body["roleId"], tenant_id))
    if not role:
        role = db.fetch_one("SELECT * FROM roles WHERE tenant_id=%s AND name=%s", (tenant_id, DEFAULT_ROLE))
    _guard_admin_role(ctx, role)
    target = db.fetch_one("SELECT * FROM users WHERE lower(email)=lower(%s)", (email,))
    temp_password = None
    if not target:
        import secrets
        temp_password = secrets.token_urlsafe(8)
        target = db.execute_returning(
            """INSERT INTO users (email, name, password_hash) VALUES (%s, %s, %s) RETURNING *""",
            (email, body.get("name") or email.split("@")[0], hash_password(temp_password)),
        )
    existing = db.fetch_one(
        "SELECT * FROM tenant_members WHERE tenant_id=%s AND user_id=%s", (tenant_id, target["id"])
    )
    if existing and existing.get("status") == "active":
        raise HTTPException(409, "该用户已是租户成员")
    if existing:
        row = db.execute_returning(
            """UPDATE tenant_members SET status='active', role_id=%s, is_tenant_admin=%s, joined_at=now()
               WHERE id=%s RETURNING *""",
            (role["id"], bool(body.get("isTenantAdmin")), existing["id"]),
        )
    else:
        row = db.execute_returning(
            """INSERT INTO tenant_members (tenant_id, user_id, role_id, status, is_tenant_admin, joined_at)
               VALUES (%s, %s, %s, 'active', %s, now()) RETURNING *""",
            (tenant_id, target["id"], role["id"], bool(body.get("isTenantAdmin"))),
        )
    _ensure_agent_for(ctx.tenant, target, role)
    log_activity(ctx, "member.added", {"userId": str(target["id"]), "email": email})
    out = serializers.member({**row, "name": target["name"], "email": target["email"], "role_name": role["name"]})
    out["tempPassword"] = temp_password
    return out


@router.patch("/tenants/{tenant_id}/members/{member_user_id}")
def update_member(tenant_id: str, member_user_id: str, body: dict = Body(...), user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id, "member.manage")
    row = db.fetch_one(
        "SELECT * FROM tenant_members WHERE tenant_id=%s AND user_id=%s", (tenant_id, member_user_id)
    )
    if not row:
        raise HTTPException(404, "成员不存在")
    # Only a tenant admin can touch another admin's role/flags, and only an
    # admin can grant the admin flag (member.manage alone must not escalate).
    if not ctx.is_tenant_admin and row.get("is_tenant_admin"):
        raise HTTPException(403, "只有租户管理员可以修改管理员成员")
    new_admin = bool(body.get("isTenantAdmin", row["is_tenant_admin"]))
    if new_admin != bool(row.get("is_tenant_admin")) and not ctx.is_tenant_admin:
        raise HTTPException(403, "只有租户管理员可以变更管理员身份")
    if row.get("is_tenant_admin") and not new_admin:
        admins = db.fetch_one(
            "SELECT count(*) AS c FROM tenant_members WHERE tenant_id=%s AND status='active' AND is_tenant_admin=TRUE",
            (tenant_id,),
        )["c"]
        if admins <= 1:
            raise HTTPException(400, "至少保留一名租户管理员")
    role_id = body.get("roleId", row.get("role_id"))
    role = None
    if role_id:
        role = db.fetch_one(
            "SELECT * FROM roles WHERE id=%s AND tenant_id=%s", (role_id, tenant_id)
        )
        if not role:
            raise HTTPException(400, "角色不存在或不属于当前租户")
        _guard_admin_role(ctx, role)
    new_status = body.get("status", row["status"])
    if new_status not in ("active", "invited", "disabled"):
        raise HTTPException(400, "无效的成员状态")
    updated = db.execute_returning(
        """UPDATE tenant_members SET role_id=%s, is_tenant_admin=%s, status=%s
           WHERE id=%s RETURNING *""",
        (role_id, new_admin, new_status, row["id"]),
    )
    target = db.fetch_one("SELECT * FROM users WHERE id=%s", (member_user_id,))
    if updated["status"] == "active":
        _ensure_agent_for(ctx.tenant, target, role)
    log_activity(ctx, "member.updated", {"userId": member_user_id, "roleId": role_id})
    return serializers.member({**updated, "name": target["name"], "email": target["email"], "role_name": (role or {}).get("name")})


@router.delete("/tenants/{tenant_id}/members/{member_user_id}")
def remove_member(tenant_id: str, member_user_id: str, user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id, "member.manage")
    row = db.fetch_one(
        "SELECT * FROM tenant_members WHERE tenant_id=%s AND user_id=%s", (tenant_id, member_user_id)
    )
    if not row:
        raise HTTPException(404, "成员不存在")
    if row.get("is_tenant_admin"):
        admins = db.fetch_one(
            "SELECT count(*) AS c FROM tenant_members WHERE tenant_id=%s AND status='active' AND is_tenant_admin=TRUE",
            (tenant_id,),
        )["c"]
        if admins <= 1:
            raise HTTPException(400, "至少保留一名租户管理员")
    db.execute("DELETE FROM tenant_members WHERE id=%s", (row["id"],))
    db.execute("DELETE FROM agents WHERE tenant_id=%s AND owner_user_id=%s", (tenant_id, member_user_id))
    log_activity(ctx, "member.removed", {"userId": member_user_id})
    return {"ok": True}


# --- join requests ------------------------------------------------------

@router.post("/tenants/{tenant_id}/join-requests")
def create_join_request(tenant_id: str, body: dict = Body(default={}), user: dict = Depends(get_current_user)):
    tenant = db.fetch_one("SELECT * FROM tenants WHERE id=%s AND status='active'", (tenant_id,))
    if not tenant:
        raise HTTPException(404, "租户不存在")
    membership = db.fetch_one(
        "SELECT * FROM tenant_members WHERE tenant_id=%s AND user_id=%s", (tenant_id, user["id"])
    )
    if membership and membership.get("status") == "active":
        raise HTTPException(400, "您已是该租户成员")
    pending = db.fetch_one(
        "SELECT * FROM tenant_join_requests WHERE tenant_id=%s AND user_id=%s AND status='pending'",
        (tenant_id, user["id"]),
    )
    if pending:
        return serializers.join_request({**pending, "name": user["name"], "email": user["email"]})
    row = db.execute_returning(
        """INSERT INTO tenant_join_requests (tenant_id, user_id, role_id, message)
           VALUES (%s, %s, %s, %s) RETURNING *""",
        (tenant_id, user["id"], body.get("roleId"), body.get("message")),
    )
    admins = db.fetch_all(
        "SELECT user_id FROM tenant_members WHERE tenant_id=%s AND is_tenant_admin=TRUE AND status='active'",
        (tenant_id,),
    )
    for a in admins:
        db.execute(
            """INSERT INTO activity_events (tenant_id, actor_kind, actor_id, actor_user_id, type, payload)
               VALUES (%s, 'human', %s, %s, 'join.requested', %s)""",
            (tenant_id, user["name"], user["id"], Json({"email": user["email"]})),
        )
    return serializers.join_request({**row, "name": user["name"], "email": user["email"]})


@router.get("/tenants/{tenant_id}/join-requests")
def list_join_requests(tenant_id: str, user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id, "member.manage")
    rows = db.fetch_all(
        """SELECT j.*, u.name, u.email FROM tenant_join_requests j
           JOIN users u ON u.id=j.user_id
           WHERE j.tenant_id=%s ORDER BY j.created_at DESC""",
        (tenant_id,),
    )
    return [serializers.join_request(r) for r in rows]


@router.post("/tenants/{tenant_id}/join-requests/{request_id}/approve")
def approve_join_request(tenant_id: str, request_id: str, body: dict = Body(default={}), user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id, "member.manage")
    req = db.fetch_one(
        "SELECT * FROM tenant_join_requests WHERE id=%s AND tenant_id=%s", (request_id, tenant_id)
    )
    if not req or req["status"] != "pending":
        raise HTTPException(404, "申请不存在或已处理")
    role = None
    if body.get("roleId"):
        role = db.fetch_one("SELECT * FROM roles WHERE id=%s AND tenant_id=%s", (body["roleId"], tenant_id))
    if not role:
        role = db.fetch_one("SELECT * FROM roles WHERE tenant_id=%s AND name=%s", (tenant_id, DEFAULT_ROLE))
    _guard_admin_role(ctx, role)
    target = db.fetch_one("SELECT * FROM users WHERE id=%s", (req["user_id"],))
    existing = db.fetch_one(
        "SELECT * FROM tenant_members WHERE tenant_id=%s AND user_id=%s", (tenant_id, req["user_id"])
    )
    if existing:
        db.execute(
            "UPDATE tenant_members SET status='active', role_id=%s, joined_at=now() WHERE id=%s",
            (role["id"], existing["id"]),
        )
    else:
        db.execute(
            """INSERT INTO tenant_members (tenant_id, user_id, role_id, status, joined_at)
               VALUES (%s, %s, %s, 'active', now())""",
            (tenant_id, req["user_id"], role["id"]),
        )
    db.execute(
        "UPDATE tenant_join_requests SET status='approved', reviewed_by=%s, reviewed_at=now() WHERE id=%s",
        (user["id"], request_id),
    )
    _ensure_agent_for(ctx.tenant, target, role)
    log_activity(ctx, "join.approved", {"userId": str(req["user_id"]), "role": role["name"]})
    return {"ok": True}


@router.post("/tenants/{tenant_id}/join-requests/{request_id}/reject")
def reject_join_request(tenant_id: str, request_id: str, user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id, "member.manage")
    req = db.fetch_one(
        "SELECT * FROM tenant_join_requests WHERE id=%s AND tenant_id=%s", (request_id, tenant_id)
    )
    if not req or req["status"] != "pending":
        raise HTTPException(404, "申请不存在或已处理")
    db.execute(
        "UPDATE tenant_join_requests SET status='rejected', reviewed_by=%s, reviewed_at=now() WHERE id=%s",
        (user["id"], request_id),
    )
    log_activity(ctx, "join.rejected", {"userId": str(req["user_id"])})
    return {"ok": True}


# --- agents -------------------------------------------------------------

@router.get("/tenants/{tenant_id}/agents")
def list_agents(tenant_id: str, user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id)
    if ctx.has("agents"):
        rows = db.fetch_all(
            """SELECT a.*, u.name AS owner_name FROM agents a
               LEFT JOIN users u ON u.id=a.owner_user_id
               WHERE a.tenant_id=%s AND (a.owner_user_id=%s OR %s)
               ORDER BY a.created_at""",
            (tenant_id, user["id"], ctx.is_tenant_admin),
        )
    else:
        rows = db.fetch_all(
            """SELECT a.*, u.name AS owner_name FROM agents a
               LEFT JOIN users u ON u.id=a.owner_user_id
               WHERE a.tenant_id=%s AND a.owner_user_id=%s""",
            (tenant_id, user["id"]),
        )
    return [serializers.agent(r) for r in rows]


@router.patch("/tenants/{tenant_id}/agents/{agent_id}")
def update_agent(tenant_id: str, agent_id: str, body: dict = Body(...), user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id)
    agent = db.fetch_one("SELECT * FROM agents WHERE id=%s AND tenant_id=%s", (agent_id, tenant_id))
    if not agent:
        raise HTTPException(404, "Agent 不存在")
    if agent.get("owner_user_id") != user["id"] and not ctx.has("agent.manage"):
        raise HTTPException(403, "只能配置自己的 Agent")
    row = db.execute_returning(
        """UPDATE agents SET name=%s, provider=%s, model=%s, description=%s, system_prompt=%s
           WHERE id=%s RETURNING *""",
        (
            body.get("name") or agent["name"],
            body.get("provider") or agent["provider"],
            body.get("model", agent.get("model")),
            body.get("description", agent.get("description")),
            body.get("systemPrompt", agent.get("system_prompt")),
            agent_id,
        ),
    )
    log_activity(ctx, "agent.updated", {"agentId": agent_id, "provider": row["provider"]})
    return serializers.agent(row)


@router.post("/tenants/{tenant_id}/agents/reset")
def reset_agent(tenant_id: str, user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id)
    agent = orchestration.reset_personal_agent(ctx)
    log_activity(ctx, "agent.reset", {"agentId": str(agent["id"])})
    return serializers.agent(agent)


# --- activity & dashboard ----------------------------------------------

@router.get("/tenants/{tenant_id}/activity")
def list_activity(tenant_id: str, limit: int = 50, user: dict = Depends(get_current_user)):
    load_tenant_context(user, tenant_id, "dashboard")
    rows = db.fetch_all(
        "SELECT * FROM activity_events WHERE tenant_id=%s ORDER BY at DESC LIMIT %s",
        (tenant_id, min(limit, 200)),
    )
    return [serializers.activity(r) for r in rows]


@router.get("/tenants/{tenant_id}/dashboard")
def dashboard(tenant_id: str, user: dict = Depends(get_current_user)):
    load_tenant_context(user, tenant_id)

    def count(table: str, extra: str = "") -> int:
        row = db.fetch_one(
            f"SELECT count(*) AS c FROM {table} WHERE tenant_id=%s {extra}", (tenant_id,)
        )
        return row["c"] if row else 0

    requirements = db.fetch_all(
        "SELECT status, count(*) AS c FROM requirements WHERE tenant_id=%s GROUP BY status", (tenant_id,)
    )
    activity = db.fetch_all(
        "SELECT * FROM activity_events WHERE tenant_id=%s ORDER BY at DESC LIMIT 15", (tenant_id,)
    )
    agents_count = count("agents")
    return {
        "counts": {
            "meetings": count("meetings"),
            "requirements": count("requirements"),
            "tasks": count("dev_tasks"),
            "testRuns": count("test_runs"),
            "artifacts": count("artifacts"),
            "repos": count("git_repos"),
            "pipelines": count("pipelines"),
            "deployments": count("deployments"),
            "environments": count("environments"),
            "monitors": count("monitors"),
            "openAlerts": count("alerts", "AND status='open'"),
            "agents": agents_count,
            "members": count("tenant_members", "AND status='active'"),
        },
        "requirementsByStatus": {r["status"]: r["c"] for r in requirements},
        "activity": [serializers.activity(a) for a in activity],
    }
