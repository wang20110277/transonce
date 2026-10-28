"""Code repository management: GitLab connections, repo browsing and the
per-repo access request/approval flow.

Connections hold an encrypted PAT (`repo.manage`). Repos are cached rows
synced from the GitLab API — or generated deterministically in demo mode —
and every tenant member with the `repos` menu can browse them and request a
GitLab-style role (guest/reporter/developer/maintainer). Approvals and
revocations need `repo.approve`.
"""
from fastapi import APIRouter, Body, Depends, HTTPException, Query
from psycopg2.extras import Json

import db
import gitlab_client
import serializers
from config import DEFAULT_REPO_ROLE, REPO_ROLES
from deps import get_current_user, load_tenant_context, log_activity
from security import decrypt_secret, encrypt_secret

router = APIRouter(prefix="/api/tenants/{tenant_id}", tags=["coderepos"])

_REPO_ROLE_IDS = [r["id"] for r in REPO_ROLES]

_REQUEST_SELECT = """SELECT q.*, r.path AS repo_path, r.name AS repo_name,
       u.name AS user_name, u.email AS user_email
FROM repo_access_requests q
JOIN git_repos r ON r.id=q.repo_id
JOIN users u ON u.id=q.user_id"""


def _connection_or_404(tenant_id: str, connection_id: str) -> dict:
    row = db.fetch_one(
        "SELECT * FROM gitlab_connections WHERE id=%s AND tenant_id=%s", (connection_id, tenant_id)
    )
    if not row:
        raise HTTPException(404, "连接不存在")
    return row


def _repo_or_404(tenant_id: str, repo_id: str) -> dict:
    row = db.fetch_one(
        """SELECT r.*, c.name AS connection_name FROM git_repos r
           JOIN gitlab_connections c ON c.id=r.connection_id
           WHERE r.id=%s AND r.tenant_id=%s""",
        (repo_id, tenant_id),
    )
    if not row:
        raise HTTPException(404, "代码库不存在")
    return row


def upsert_projects(connection: dict, projects: list[dict]) -> int:
    """Refresh the tenant's cached repo rows for one connection."""
    count = 0
    for p in projects:
        db.execute(
            """INSERT INTO git_repos
               (tenant_id, connection_id, external_id, path, name, namespace, web_url,
                description, default_branch, visibility, archived, last_activity_at, fetched_at)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s, now())
               ON CONFLICT (connection_id, external_id) DO UPDATE SET
                 path=EXCLUDED.path, name=EXCLUDED.name, namespace=EXCLUDED.namespace,
                 web_url=EXCLUDED.web_url, description=EXCLUDED.description,
                 default_branch=EXCLUDED.default_branch, visibility=EXCLUDED.visibility,
                 archived=EXCLUDED.archived, last_activity_at=EXCLUDED.last_activity_at,
                 fetched_at=now()""",
            (
                connection["tenant_id"], connection["id"], p["external_id"], p["path"], p["name"],
                p.get("namespace"), p.get("web_url"), p.get("description"),
                p.get("default_branch") or "main", p.get("visibility") or "private",
                bool(p.get("archived")), p.get("last_activity_at"),
            ),
        )
        count += 1
    return count


# --- GitLab connections ---------------------------------------------------

@router.get("/gitlab/connections")
def list_connections(tenant_id: str, user: dict = Depends(get_current_user)):
    load_tenant_context(user, tenant_id, "repos")
    rows = db.fetch_all(
        """SELECT c.*, (SELECT count(*) FROM git_repos r WHERE r.connection_id=c.id) AS repo_count
           FROM gitlab_connections c WHERE c.tenant_id=%s ORDER BY c.created_at""",
        (tenant_id,),
    )
    return [serializers.gitlab_connection(r) for r in rows]


@router.post("/gitlab/connections")
def create_connection(tenant_id: str, body: dict = Body(...), user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id, "repo.manage")
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "请输入连接名称")
    mode = body.get("mode") or "live"
    if mode not in ("live", "demo"):
        raise HTTPException(400, "无效的连接模式")
    token = (body.get("token") or "").strip()
    try:
        base_url = gitlab_client.normalize_base_url(body.get("baseUrl") or "")
    except gitlab_client.GitlabError as e:
        raise HTTPException(400, str(e)) from e
    account = None
    if mode == "live":
        if not token:
            raise HTTPException(400, "真实模式需要 GitLab 访问令牌（建议只读 read_api 权限）")
        try:
            account = gitlab_client.fetch_current_user(base_url, token).get("username")
        except gitlab_client.GitlabError as e:
            raise HTTPException(400, f"连接测试失败：{e}") from e
    row = db.execute_returning(
        """INSERT INTO gitlab_connections
           (tenant_id, name, base_url, token_enc, account, mode, status, created_by)
           VALUES (%s,%s,%s,%s,%s,%s,'active',%s) RETURNING *""",
        (tenant_id, name, base_url, encrypt_secret(token), account, mode, user["id"]),
    )
    log_activity(
        ctx, "gitlab.connected",
        {"name": name, "baseUrl": base_url, "mode": mode, "account": account},
    )
    return serializers.gitlab_connection({**row, "repo_count": 0})


@router.patch("/gitlab/connections/{connection_id}")
def update_connection(
    tenant_id: str, connection_id: str, body: dict = Body(...), user: dict = Depends(get_current_user)
):
    ctx = load_tenant_context(user, tenant_id, "repo.manage")
    conn = _connection_or_404(tenant_id, connection_id)
    name = (body.get("name") or "").strip() or conn["name"]
    mode = body.get("mode") or conn["mode"]
    if mode not in ("live", "demo"):
        raise HTTPException(400, "无效的连接模式")
    try:
        base_url = gitlab_client.normalize_base_url(body.get("baseUrl") or conn["base_url"])
    except gitlab_client.GitlabError as e:
        raise HTTPException(400, str(e)) from e
    token = (body.get("token") or "").strip()
    token_enc = encrypt_secret(token) if token else conn.get("token_enc")
    account = conn.get("account")
    if mode == "live" and not token_enc:
        raise HTTPException(400, "真实模式需要 GitLab 访问令牌")
    if mode == "live" and (token or base_url != conn["base_url"]):
        try:
            account = gitlab_client.fetch_current_user(base_url, decrypt_secret(token_enc) or "").get("username")
        except gitlab_client.GitlabError as e:
            raise HTTPException(400, f"连接测试失败：{e}") from e
    row = db.execute_returning(
        """UPDATE gitlab_connections
           SET name=%s, base_url=%s, token_enc=%s, account=%s, mode=%s, status='active', last_error=NULL
           WHERE id=%s RETURNING *""",
        (name, base_url, token_enc, account, mode, connection_id),
    )
    repo_count = db.fetch_one(
        "SELECT count(*) AS c FROM git_repos WHERE connection_id=%s", (connection_id,)
    )["c"]
    log_activity(ctx, "gitlab.updated", {"name": name, "mode": mode})
    return serializers.gitlab_connection({**row, "repo_count": repo_count})


@router.delete("/gitlab/connections/{connection_id}")
def delete_connection(tenant_id: str, connection_id: str, user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id, "repo.manage")
    conn = _connection_or_404(tenant_id, connection_id)
    db.execute("DELETE FROM gitlab_connections WHERE id=%s", (connection_id,))
    log_activity(ctx, "gitlab.disconnected", {"name": conn["name"]})
    return {"ok": True}


@router.post("/gitlab/connections/{connection_id}/sync")
def sync_connection(tenant_id: str, connection_id: str, user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id, "repo.manage")
    conn = _connection_or_404(tenant_id, connection_id)
    if conn["mode"] == "demo":
        projects, source = gitlab_client.demo_projects(), "demo"
    else:
        try:
            projects = gitlab_client.fetch_projects(conn["base_url"], decrypt_secret(conn.get("token_enc")) or "")
            source = "gitlab"
        except gitlab_client.GitlabError as e:
            db.execute(
                "UPDATE gitlab_connections SET status='error', last_error=%s WHERE id=%s",
                (str(e), connection_id),
            )
            raise HTTPException(502, f"同步失败：{e}") from e
    count = upsert_projects(conn, projects)
    row = db.execute_returning(
        """UPDATE gitlab_connections
           SET status='active', last_error=NULL, last_sync_at=now() WHERE id=%s RETURNING *""",
        (connection_id,),
    )
    log_activity(ctx, "repos.synced", {"connection": conn["name"], "count": count, "source": source})
    return {
        "ok": True, "count": count, "source": source,
        "connection": serializers.gitlab_connection({**row, "repo_count": count}),
    }


# --- repositories ---------------------------------------------------------

def _annotate(repo_rows: list[dict], user_id: str) -> list[dict]:
    grants = {
        g["repo_id"]: g
        for g in db.fetch_all(
            "SELECT * FROM repo_access_grants WHERE tenant_id=%s AND user_id=%s", (repo_rows[0]["tenant_id"], user_id)
        )
    } if repo_rows else {}
    pendings = {
        p["repo_id"]: p
        for p in db.fetch_all(
            "SELECT * FROM repo_access_requests WHERE tenant_id=%s AND user_id=%s AND status='pending'",
            (repo_rows[0]["tenant_id"], user_id),
        )
    } if repo_rows else {}
    out = []
    for r in repo_rows:
        item = serializers.git_repo(r)
        g, p = grants.get(r["id"]), pendings.get(r["id"])
        item["myAccess"] = {"role": g["role"], "grantedAt": g["granted_at"].isoformat()} if g else None
        item["myRequest"] = {"id": str(p["id"]), "role": p["role"], "status": p["status"]} if p else None
        out.append(item)
    return out


@router.get("/repos")
def list_repos(
    tenant_id: str,
    q: str | None = Query(default=None),
    connection_id: str | None = Query(default=None),
    user: dict = Depends(get_current_user),
):
    load_tenant_context(user, tenant_id, "repos")
    rows = db.fetch_all(
        """SELECT r.*, c.name AS connection_name FROM git_repos r
           JOIN gitlab_connections c ON c.id=r.connection_id
           WHERE r.tenant_id=%s ORDER BY r.path""",
        (tenant_id,),
    )
    if connection_id:
        rows = [r for r in rows if str(r["connection_id"]) == connection_id]
    if q:
        needle = q.strip().lower()
        rows = [r for r in rows if needle in r["path"].lower() or needle in (r.get("description") or "").lower()]
    return _annotate(rows, user["id"])


@router.get("/repos/{repo_id}")
def get_repo(tenant_id: str, repo_id: str, user: dict = Depends(get_current_user)):
    load_tenant_context(user, tenant_id, "repos")
    repo = _repo_or_404(tenant_id, repo_id)
    members = db.fetch_all(
        """SELECT g.*, u.name AS user_name, u.email AS user_email
           FROM repo_access_grants g JOIN users u ON u.id=g.user_id
           WHERE g.repo_id=%s ORDER BY g.granted_at""",
        (repo_id,),
    )
    return {
        **_annotate([repo], user["id"])[0],
        "members": [serializers.repo_access_grant(m) for m in members],
    }


# --- access requests ------------------------------------------------------

def _request_or_404(tenant_id: str, request_id: str) -> dict:
    row = db.fetch_one(
        f"{_REQUEST_SELECT} WHERE q.id=%s AND q.tenant_id=%s", (request_id, tenant_id)
    )
    if not row:
        raise HTTPException(404, "申请不存在")
    return row


@router.post("/repos/{repo_id}/access-requests")
def create_access_request(
    tenant_id: str, repo_id: str, body: dict = Body(default={}), user: dict = Depends(get_current_user)
):
    ctx = load_tenant_context(user, tenant_id, "repos")
    repo = _repo_or_404(tenant_id, repo_id)
    role = body.get("role") or DEFAULT_REPO_ROLE
    if role not in _REPO_ROLE_IDS:
        raise HTTPException(400, f"无效的代码库角色: {role}")
    grant = db.fetch_one(
        "SELECT * FROM repo_access_grants WHERE repo_id=%s AND user_id=%s", (repo_id, user["id"])
    )
    if grant and grant["role"] == role:
        raise HTTPException(400, "您已拥有该角色的代码库权限")
    reason = (body.get("reason") or "").strip() or None
    pending = db.fetch_one(
        "SELECT * FROM repo_access_requests WHERE repo_id=%s AND user_id=%s AND status='pending'",
        (repo_id, user["id"]),
    )
    if pending:
        # adjust the requested role/reason instead of stacking duplicates
        db.execute(
            "UPDATE repo_access_requests SET role=%s, reason=%s WHERE id=%s",
            (role, reason, pending["id"]),
        )
    else:
        db.execute(
            """INSERT INTO repo_access_requests (tenant_id, repo_id, user_id, role, reason)
               VALUES (%s,%s,%s,%s,%s)""",
            (tenant_id, repo_id, user["id"], role, reason),
        )
    log_activity(ctx, "repo.access_requested", {"repo": repo["path"], "role": role})
    row = db.fetch_one(
        f"{_REQUEST_SELECT} WHERE q.repo_id=%s AND q.user_id=%s AND q.status='pending'",
        (repo_id, user["id"]),
    )
    return serializers.repo_access_request(row)


@router.get("/repo-access-requests/mine")
def my_access_requests(tenant_id: str, user: dict = Depends(get_current_user)):
    load_tenant_context(user, tenant_id, "repos")
    rows = db.fetch_all(
        f"{_REQUEST_SELECT} WHERE q.tenant_id=%s AND q.user_id=%s ORDER BY q.created_at DESC",
        (tenant_id, user["id"]),
    )
    return [serializers.repo_access_request(r) for r in rows]


@router.get("/repo-access-requests")
def list_access_requests(
    tenant_id: str,
    status: str | None = Query(default=None),
    user: dict = Depends(get_current_user),
):
    load_tenant_context(user, tenant_id, "repo.approve")
    if status:
        rows = db.fetch_all(
            f"""{_REQUEST_SELECT} WHERE q.tenant_id=%s AND q.status=%s
                ORDER BY q.created_at DESC""",
            (tenant_id, status),
        )
    else:
        rows = db.fetch_all(
            f"{_REQUEST_SELECT} WHERE q.tenant_id=%s ORDER BY q.created_at DESC", (tenant_id,)
        )
    return [serializers.repo_access_request(r) for r in rows]


@router.post("/repo-access-requests/{request_id}/approve")
def approve_access_request(
    tenant_id: str, request_id: str, body: dict = Body(default={}), user: dict = Depends(get_current_user)
):
    ctx = load_tenant_context(user, tenant_id, "repo.approve")
    req = _request_or_404(tenant_id, request_id)
    if req["status"] != "pending":
        raise HTTPException(400, "该申请已处理")
    role = body.get("role") or req["role"]
    if role not in _REPO_ROLE_IDS:
        raise HTTPException(400, f"无效的代码库角色: {role}")
    db.execute(
        """INSERT INTO repo_access_grants (tenant_id, repo_id, user_id, role, granted_by)
           VALUES (%s,%s,%s,%s,%s)
           ON CONFLICT (repo_id, user_id) DO UPDATE SET
             role=EXCLUDED.role, granted_by=EXCLUDED.granted_by, granted_at=now()""",
        (tenant_id, req["repo_id"], req["user_id"], role, user["id"]),
    )
    db.execute(
        """UPDATE repo_access_requests
           SET status='approved', reviewed_by=%s, reviewed_at=now(), review_note=%s
           WHERE id=%s""",
        (user["id"], (body.get("note") or "").strip() or None, request_id),
    )
    log_activity(
        ctx, "repo.access_granted",
        {"repo": req["repo_path"], "userId": str(req["user_id"]), "role": role},
    )
    return serializers.repo_access_request(_request_or_404(tenant_id, request_id))


@router.post("/repo-access-requests/{request_id}/reject")
def reject_access_request(
    tenant_id: str, request_id: str, body: dict = Body(default={}), user: dict = Depends(get_current_user)
):
    ctx = load_tenant_context(user, tenant_id, "repo.approve")
    req = _request_or_404(tenant_id, request_id)
    if req["status"] != "pending":
        raise HTTPException(400, "该申请已处理")
    db.execute(
        """UPDATE repo_access_requests
           SET status='rejected', reviewed_by=%s, reviewed_at=now(), review_note=%s
           WHERE id=%s""",
        (user["id"], (body.get("note") or "").strip() or None, request_id),
    )
    log_activity(ctx, "repo.access_rejected", {"repo": req["repo_path"], "userId": str(req["user_id"])})
    return serializers.repo_access_request(_request_or_404(tenant_id, request_id))


@router.delete("/repos/{repo_id}/access/{member_user_id}")
def revoke_access(
    tenant_id: str, repo_id: str, member_user_id: str, user: dict = Depends(get_current_user)
):
    ctx = load_tenant_context(user, tenant_id, "repo.approve")
    repo = _repo_or_404(tenant_id, repo_id)
    grant = db.fetch_one(
        "SELECT * FROM repo_access_grants WHERE repo_id=%s AND user_id=%s", (repo_id, member_user_id)
    )
    if not grant:
        raise HTTPException(404, "该成员没有此代码库的权限")
    db.execute("DELETE FROM repo_access_grants WHERE id=%s", (grant["id"],))
    log_activity(ctx, "repo.access_revoked", {"repo": repo["path"], "userId": member_user_id})
    return {"ok": True}
