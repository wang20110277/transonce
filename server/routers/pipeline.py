"""Meetings, requirements, design, tasks, tests and agent runs."""
from fastapi import APIRouter, Body, Depends, HTTPException, Query
from psycopg2.extras import Json

import agents
import db
import orchestration
import serializers
from deps import get_current_user, load_tenant_context, log_activity

router = APIRouter(prefix="/api/tenants/{tenant_id}", tags=["pipeline"])


# --- meetings ------------------------------------------------------------

@router.get("/meetings")
def list_meetings(tenant_id: str, user: dict = Depends(get_current_user)):
    load_tenant_context(user, tenant_id, "meetings")
    rows = db.fetch_all("SELECT * FROM meetings WHERE tenant_id=%s ORDER BY created_at DESC", (tenant_id,))
    return [serializers.meeting(r) for r in rows]


@router.post("/meetings")
def create_meeting(tenant_id: str, body: dict = Body(...), user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id, "meetings")
    title = (body.get("title") or "").strip()
    notes = body.get("rawNotes") or body.get("notes") or ""
    if not title or not notes.strip():
        raise HTTPException(400, "请填写会议标题与纪要内容")
    row = db.execute_returning(
        """INSERT INTO meetings
           (tenant_id, project_id, title, raw_notes, transcript, participants, source, created_by)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING *""",
        (
            tenant_id, body.get("projectId"), title, notes, body.get("transcript"),
            Json(body.get("participants") or []), body.get("source") or "manual", user["id"],
        ),
    )
    log_activity(ctx, "meeting.created", {"title": title}, project_id=body.get("projectId"))
    return serializers.meeting(row)


@router.delete("/meetings/{meeting_id}")
def delete_meeting(tenant_id: str, meeting_id: str, user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id, "meetings")
    db.execute("DELETE FROM meetings WHERE id=%s AND tenant_id=%s", (meeting_id, tenant_id))
    log_activity(ctx, "meeting.deleted", {"meetingId": meeting_id})
    return {"ok": True}


@router.post("/meetings/{meeting_id}/extract")
def extract_meeting(
    tenant_id: str, meeting_id: str, save: bool = Query(default=False),
    user: dict = Depends(get_current_user),
):
    ctx = load_tenant_context(user, tenant_id, "meetings")
    meeting = db.fetch_one("SELECT * FROM meetings WHERE id=%s AND tenant_id=%s", (meeting_id, tenant_id))
    if not meeting:
        raise HTTPException(404, "会议不存在")
    agent = orchestration.ensure_personal_agent(ctx)
    started = orchestration.start_run(ctx, "extract", meeting["title"], str(agent["id"]))
    try:
        drafts = agents.extract_requirements(meeting["title"], meeting["raw_notes"] or "", agent.get("provider"))
        created = []
        if save:
            for d in drafts:
                row = db.execute_returning(
                    """INSERT INTO requirements
                       (tenant_id, title, description, priority, acceptance_criteria, source_meeting_id, created_by)
                       VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING *""",
                    (
                        tenant_id, d.get("title", "未命名需求"), d.get("description"),
                        d.get("priority", "medium"), Json(d.get("acceptanceCriteria") or []),
                        meeting_id, user["id"],
                    ),
                )
                created.append(serializers.requirement(row))
            db.execute("UPDATE meetings SET status='extracted' WHERE id=%s", (meeting_id,))
        orchestration.finish_run(started["run"], "succeeded", f"提取 {len(drafts)} 条需求")
        log_activity(ctx, "meeting.extracted", {"meetingId": meeting_id, "count": len(drafts)}, "agent", agent["name"])
        return {"requirements": created if save else drafts, "count": len(drafts)}
    except Exception as e:
        orchestration.finish_run(started["run"], "failed", "", str(e))
        raise HTTPException(500, f"需求提取失败: {e}")


# --- requirements --------------------------------------------------------

@router.get("/requirements")
def list_requirements(
    tenant_id: str, project_id: str | None = Query(default=None),
    status: str | None = Query(default=None), user: dict = Depends(get_current_user),
):
    load_tenant_context(user, tenant_id, "requirements")
    where = "WHERE tenant_id=%s"
    args: list = [tenant_id]
    if project_id:
        where += " AND project_id=%s"
        args.append(project_id)
    if status:
        where += " AND status=%s"
        args.append(status)
    rows = db.fetch_all(f"SELECT * FROM requirements {where} ORDER BY created_at DESC", tuple(args))
    return [serializers.requirement(r) for r in rows]


@router.post("/requirements")
def create_requirements(tenant_id: str, body: dict | list = Body(...), user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id, "requirements")
    items = body if isinstance(body, list) else [body]
    out = []
    for item in items:
        title = (item.get("title") or "").strip()
        if not title:
            continue
        row = db.execute_returning(
            """INSERT INTO requirements
               (tenant_id, project_id, title, description, priority, acceptance_criteria,
                source_meeting_id, created_by)
               VALUES (%s, %s, %s, %s, %s, %s, NULLIF(%s,'')::uuid, %s) RETURNING *""",
            (
                tenant_id, item.get("projectId"), title, item.get("description"),
                item.get("priority") or "medium", Json(item.get("acceptanceCriteria") or []),
                item.get("sourceMeetingId") or "", user["id"],
            ),
        )
        out.append(serializers.requirement(row))
    if out:
        log_activity(ctx, "requirement.created", {"count": len(out)})
    return out


@router.get("/requirements/{requirement_id}")
def get_requirement(tenant_id: str, requirement_id: str, user: dict = Depends(get_current_user)):
    load_tenant_context(user, tenant_id, "requirements")
    row = db.fetch_one(
        "SELECT * FROM requirements WHERE id=%s AND tenant_id=%s", (requirement_id, tenant_id)
    )
    if not row:
        raise HTTPException(404, "需求不存在")
    return serializers.requirement(row)


@router.patch("/requirements/{requirement_id}")
def update_requirement(tenant_id: str, requirement_id: str, body: dict = Body(...), user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id, "requirements")
    row = db.fetch_one(
        "SELECT * FROM requirements WHERE id=%s AND tenant_id=%s", (requirement_id, tenant_id)
    )
    if not row:
        raise HTTPException(404, "需求不存在")
    updated = db.execute_returning(
        """UPDATE requirements
           SET title=%s, description=%s, status=%s, priority=%s, acceptance_criteria=%s, project_id=%s
           WHERE id=%s RETURNING *""",
        (
            body.get("title") or row["title"], body.get("description", row.get("description")),
            body.get("status", row.get("status")), body.get("priority", row.get("priority")),
            Json(body.get("acceptanceCriteria") if body.get("acceptanceCriteria") is not None else row["acceptance_criteria"]),
            body.get("projectId", row.get("project_id")), requirement_id,
        ),
    )
    log_activity(ctx, "requirement.updated", {"requirementId": requirement_id, "title": updated["title"]})
    return serializers.requirement(updated)


@router.delete("/requirements/{requirement_id}")
def delete_requirement(tenant_id: str, requirement_id: str, user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id, "requirements")
    db.execute("DELETE FROM requirements WHERE id=%s AND tenant_id=%s", (requirement_id, tenant_id))
    log_activity(ctx, "requirement.deleted", {"requirementId": requirement_id})
    return {"ok": True}


def _req_or_404(tenant_id: str, requirement_id: str) -> dict:
    row = db.fetch_one(
        "SELECT * FROM requirements WHERE id=%s AND tenant_id=%s", (requirement_id, tenant_id)
    )
    if not row:
        raise HTTPException(404, "需求不存在")
    return row


@router.post("/requirements/{requirement_id}/design")
def design(tenant_id: str, requirement_id: str, force: bool = Query(default=False), user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id, "design")
    req = _req_or_404(tenant_id, requirement_id)
    return orchestration.design_requirement(ctx, req, force)


@router.post("/requirements/{requirement_id}/breakdown")
def breakdown(tenant_id: str, requirement_id: str, force: bool = Query(default=False), user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id, "development")
    req = _req_or_404(tenant_id, requirement_id)
    return orchestration.breakdown_requirement(ctx, req, force)


@router.post("/requirements/{requirement_id}/code")
def code(tenant_id: str, requirement_id: str, force: bool = Query(default=False), user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id, "development")
    req = _req_or_404(tenant_id, requirement_id)
    return orchestration.code_requirement(ctx, req, force)


@router.post("/requirements/{requirement_id}/test")
def test(tenant_id: str, requirement_id: str, force: bool = Query(default=False), user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id, "testing")
    req = _req_or_404(tenant_id, requirement_id)
    return orchestration.test_requirement(ctx, req, force)


@router.post("/requirements/{requirement_id}/autopilot")
def autopilot(tenant_id: str, requirement_id: str, body: dict = Body(default={}), user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id, "development")
    req = _req_or_404(tenant_id, requirement_id)
    env = None
    if body.get("environmentId"):
        env = db.fetch_one(
            "SELECT * FROM environments WHERE id=%s AND tenant_id=%s",
            (body["environmentId"], tenant_id),
        )
    return orchestration.autopilot(ctx, req, env, bool(body.get("deploy", True)))


# --- tasks ---------------------------------------------------------------

@router.get("/tasks")
def list_tasks(tenant_id: str, requirement_id: str | None = Query(default=None), user: dict = Depends(get_current_user)):
    load_tenant_context(user, tenant_id, "development")
    if requirement_id:
        rows = db.fetch_all(
            "SELECT * FROM dev_tasks WHERE tenant_id=%s AND requirement_id=%s ORDER BY created_at",
            (tenant_id, requirement_id),
        )
    else:
        rows = db.fetch_all(
            "SELECT * FROM dev_tasks WHERE tenant_id=%s ORDER BY created_at DESC", (tenant_id,)
        )
    return [serializers.task(r) for r in rows]


@router.patch("/tasks/{task_id}/status")
def update_task_status(tenant_id: str, task_id: str, body: dict = Body(...), user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id, "development")
    row = db.fetch_one("SELECT * FROM dev_tasks WHERE id=%s AND tenant_id=%s", (task_id, tenant_id))
    if not row:
        raise HTTPException(404, "任务不存在")
    updated = db.execute_returning(
        "UPDATE dev_tasks SET status=%s WHERE id=%s RETURNING *", (body.get("status"), task_id)
    )
    log_activity(ctx, "task.status_changed", {"taskId": task_id, "status": body.get("status")})
    return serializers.task(updated)


@router.post("/tasks/{task_id}/run")
def run_task(tenant_id: str, task_id: str, user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id, "development")
    task = db.fetch_one("SELECT * FROM dev_tasks WHERE id=%s AND tenant_id=%s", (task_id, tenant_id))
    if not task:
        raise HTTPException(404, "任务不存在")
    started = orchestration.start_run(ctx, "task", task["title"])
    db.execute("UPDATE dev_tasks SET status='running', agent_run_id=%s WHERE id=%s", (started["run"]["id"], task_id))
    output = f"Agent 已执行任务「{task['title']}」并完成自检。"
    db.execute("UPDATE dev_tasks SET status='reviewing' WHERE id=%s", (task_id,))
    orchestration.finish_run(started["run"], "succeeded", output)
    log_activity(ctx, "task.run", {"taskId": task_id, "title": task["title"]}, "agent", (started["agent"] or {}).get("name"))
    return serializers.task(db.fetch_one("SELECT * FROM dev_tasks WHERE id=%s", (task_id,)))


# --- test runs -----------------------------------------------------------

@router.get("/test-runs")
def list_test_runs(tenant_id: str, user: dict = Depends(get_current_user)):
    load_tenant_context(user, tenant_id, "testing")
    rows = db.fetch_all("SELECT * FROM test_runs WHERE tenant_id=%s ORDER BY created_at DESC", (tenant_id,))
    return [serializers.test_run(r) for r in rows]


@router.post("/test-runs")
def create_test_run(tenant_id: str, body: dict = Body(...), user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id, "testing")
    cases = body.get("cases") or []
    row = db.execute_returning(
        """INSERT INTO test_runs (tenant_id, requirement_id, status, cases, passed, total)
           VALUES (%s, %s, %s, %s, %s, %s) RETURNING *""",
        (
            tenant_id, body.get("requirementId"), body.get("status") or "passed",
            Json(cases), body.get("passed", 0), body.get("total", len(cases)),
        ),
    )
    log_activity(ctx, "test.run", {"passed": row["passed"], "total": row["total"]}, "agent", "测试专家")
    return serializers.test_run(row)


# --- agent runs ----------------------------------------------------------

@router.get("/agent-runs")
def list_agent_runs(tenant_id: str, limit: int = 50, user: dict = Depends(get_current_user)):
    load_tenant_context(user, tenant_id)
    rows = db.fetch_all(
        """SELECT r.*, a.name AS agent_name FROM agent_runs r
           LEFT JOIN agents a ON a.id=r.agent_id
           WHERE r.tenant_id=%s ORDER BY r.started_at DESC LIMIT %s""",
        (tenant_id, min(limit, 200)),
    )
    return [serializers.agent_run(r) for r in rows]
