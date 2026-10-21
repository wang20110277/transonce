"""Projects → systems → codebases."""
from fastapi import APIRouter, Body, Depends, HTTPException
from psycopg2.extras import Json

import db
import serializers
from deps import get_current_user, load_tenant_context, log_activity

router = APIRouter(prefix="/api/tenants/{tenant_id}", tags=["projects"])


def _project_or_404(tenant_id: str, project_id: str) -> dict:
    row = db.fetch_one(
        "SELECT * FROM projects WHERE id=%s AND tenant_id=%s", (project_id, tenant_id)
    )
    if not row:
        raise HTTPException(404, "项目不存在")
    return row


def _system_or_404(tenant_id: str, system_id: str) -> dict:
    row = db.fetch_one(
        """SELECT s.* FROM systems s JOIN projects p ON p.id=s.project_id
           WHERE s.id=%s AND p.tenant_id=%s""",
        (system_id, tenant_id),
    )
    if not row:
        raise HTTPException(404, "系统不存在")
    return row


PROJECT_SELECT = """
    SELECT p.*, (SELECT count(*) FROM systems s WHERE s.project_id=p.id) AS system_count
    FROM projects p WHERE p.tenant_id=%s
"""


@router.get("/projects")
def list_projects(tenant_id: str, user: dict = Depends(get_current_user)):
    load_tenant_context(user, tenant_id)
    rows = db.fetch_all(PROJECT_SELECT + " ORDER BY p.created_at DESC", (tenant_id,))
    return [serializers.project(r) for r in rows]


@router.post("/projects")
def create_project(tenant_id: str, body: dict = Body(...), user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id)
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "请输入项目名称")
    row = db.execute_returning(
        """INSERT INTO projects (tenant_id, name, description, created_by)
           VALUES (%s, %s, %s, %s) RETURNING *""",
        (tenant_id, name, body.get("description"), user["id"]),
    )
    log_activity(ctx, "project.created", {"name": name}, project_id=str(row["id"]))
    return serializers.project({**row, "system_count": 0})


@router.patch("/projects/{project_id}")
def update_project(tenant_id: str, project_id: str, body: dict = Body(...), user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id)
    row = _project_or_404(tenant_id, project_id)
    updated = db.execute_returning(
        "UPDATE projects SET name=%s, description=%s, status=%s WHERE id=%s RETURNING *",
        (body.get("name") or row["name"], body.get("description", row.get("description")),
         body.get("status", row.get("status")), project_id),
    )
    log_activity(ctx, "project.updated", {"name": updated["name"]}, project_id=project_id)
    return serializers.project(updated)


@router.delete("/projects/{project_id}")
def delete_project(tenant_id: str, project_id: str, user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id)
    _project_or_404(tenant_id, project_id)
    db.execute("DELETE FROM projects WHERE id=%s", (project_id,))
    log_activity(ctx, "project.deleted", {"projectId": project_id})
    return {"ok": True}


@router.get("/projects/{project_id}/systems")
def list_systems(tenant_id: str, project_id: str, user: dict = Depends(get_current_user)):
    load_tenant_context(user, tenant_id)
    _project_or_404(tenant_id, project_id)
    rows = db.fetch_all("SELECT * FROM systems WHERE project_id=%s ORDER BY created_at", (project_id,))
    out = []
    for s in rows:
        item = serializers.system(s)
        item["codebases"] = [
            serializers.codebase(c)
            for c in db.fetch_all("SELECT * FROM codebases WHERE system_id=%s ORDER BY created_at", (s["id"],))
        ]
        out.append(item)
    return out


@router.post("/projects/{project_id}/systems")
def create_system(tenant_id: str, project_id: str, body: dict = Body(...), user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id)
    _project_or_404(tenant_id, project_id)
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "请输入系统名称")
    row = db.execute_returning(
        "INSERT INTO systems (project_id, name, description) VALUES (%s, %s, %s) RETURNING *",
        (project_id, name, body.get("description")),
    )
    log_activity(ctx, "system.created", {"name": name}, project_id=project_id)
    return serializers.system(row)


@router.delete("/systems/{system_id}")
def delete_system(tenant_id: str, system_id: str, user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id)
    _system_or_404(tenant_id, system_id)
    db.execute("DELETE FROM systems WHERE id=%s", (system_id,))
    log_activity(ctx, "system.deleted", {"systemId": system_id})
    return {"ok": True}


@router.post("/systems/{system_id}/codebases")
def create_codebase(tenant_id: str, system_id: str, body: dict = Body(...), user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id)
    _system_or_404(tenant_id, system_id)
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "请输入代码库名称")
    row = db.execute_returning(
        """INSERT INTO codebases (system_id, name, repo_url, language, default_branch)
           VALUES (%s, %s, %s, %s, %s) RETURNING *""",
        (system_id, name, body.get("repoUrl"), body.get("language"), body.get("defaultBranch") or "main"),
    )
    log_activity(ctx, "codebase.created", {"name": name})
    return serializers.codebase(row)


@router.delete("/codebases/{codebase_id}")
def delete_codebase(tenant_id: str, codebase_id: str, user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id)
    row = db.fetch_one(
        """SELECT c.* FROM codebases c JOIN systems s ON s.id=c.system_id
           JOIN projects p ON p.id=s.project_id WHERE c.id=%s AND p.tenant_id=%s""",
        (codebase_id, tenant_id),
    )
    if not row:
        raise HTTPException(404, "代码库不存在")
    db.execute("DELETE FROM codebases WHERE id=%s", (codebase_id,))
    log_activity(ctx, "codebase.deleted", {"codebaseId": codebase_id})
    return {"ok": True}
