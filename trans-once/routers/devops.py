"""Environments (human-managed IP/secrets), artifacts, CI/CD, deployments,
monitoring and alerting."""
from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from psycopg2.extras import Json

import db
import net_guard
import orchestration
import serializers
from deps import get_current_user, load_tenant_context, log_activity
from security import decrypt_secret, encrypt_secret

router = APIRouter(prefix="/api/tenants/{tenant_id}", tags=["devops"])


def _env_or_404(tenant_id: str, environment_id: str) -> dict:
    row = db.fetch_one(
        "SELECT * FROM environments WHERE id=%s AND tenant_id=%s", (environment_id, tenant_id)
    )
    if not row:
        raise HTTPException(404, "环境不存在")
    return row


# --- environments --------------------------------------------------------

@router.get("/environments")
def list_environments(tenant_id: str, user: dict = Depends(get_current_user)):
    load_tenant_context(user, tenant_id, "environments")
    rows = db.fetch_all(
        "SELECT * FROM environments WHERE tenant_id=%s ORDER BY created_at", (tenant_id,)
    )
    return [serializers.environment(r) for r in rows]


@router.post("/environments")
def create_environment(tenant_id: str, body: dict = Body(...), user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id, "env.manage")
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "请输入环境名称")
    row = db.execute_returning(
        """INSERT INTO environments
           (tenant_id, name, kind, base_url, ip, username, password_enc, config, managed_by)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING *""",
        (
            tenant_id, name, body.get("kind") or "test", body.get("baseUrl"), body.get("ip"),
            body.get("username"), encrypt_secret(body.get("password")),
            Json(body.get("config") or {}), user["id"],
        ),
    )
    log_activity(ctx, "environment.created", {"name": name, "kind": row["kind"]})
    return serializers.environment(row)


@router.patch("/environments/{environment_id}")
def update_environment(tenant_id: str, environment_id: str, body: dict = Body(...), user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id, "env.manage")
    env = _env_or_404(tenant_id, environment_id)
    password_enc = encrypt_secret(body["password"]) if body.get("password") else env.get("password_enc")
    row = db.execute_returning(
        """UPDATE environments
           SET name=%s, kind=%s, base_url=%s, ip=%s, username=%s, password_enc=%s, config=%s
           WHERE id=%s RETURNING *""",
        (
            body.get("name") or env["name"], body.get("kind", env["kind"]),
            body.get("baseUrl", env.get("base_url")), body.get("ip", env.get("ip")),
            body.get("username", env.get("username")), password_enc,
            Json(body.get("config") if body.get("config") is not None else env.get("config") or {}),
            environment_id,
        ),
    )
    log_activity(ctx, "environment.updated", {"name": row["name"]})
    return serializers.environment(row)


@router.delete("/environments/{environment_id}")
def delete_environment(tenant_id: str, environment_id: str, user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id, "env.manage")
    env = _env_or_404(tenant_id, environment_id)
    db.execute("DELETE FROM environments WHERE id=%s", (environment_id,))
    log_activity(ctx, "environment.deleted", {"name": env["name"]})
    return {"ok": True}


@router.post("/environments/{environment_id}/reveal")
def reveal_password(tenant_id: str, environment_id: str, user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id, "secret.read")
    env = _env_or_404(tenant_id, environment_id)
    log_activity(ctx, "environment.secret_revealed", {"name": env["name"]})
    return {"password": decrypt_secret(env.get("password_enc"))}


# --- artifacts -----------------------------------------------------------

@router.get("/artifacts")
def list_artifacts(
    tenant_id: str,
    limit: int = Query(default=200, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    user: dict = Depends(get_current_user),
):
    load_tenant_context(user, tenant_id, "artifacts")
    rows = db.fetch_all(
        "SELECT * FROM artifacts WHERE tenant_id=%s ORDER BY created_at DESC LIMIT %s OFFSET %s",
        (tenant_id, limit, offset),
    )
    return [serializers.artifact(r) for r in rows]


@router.get("/artifacts/{artifact_id}")
def get_artifact(tenant_id: str, artifact_id: str, user: dict = Depends(get_current_user)):
    load_tenant_context(user, tenant_id, "artifacts")
    row = db.fetch_one("SELECT * FROM artifacts WHERE id=%s AND tenant_id=%s", (artifact_id, tenant_id))
    if not row:
        raise HTTPException(404, "制品不存在")
    return serializers.artifact(row)


@router.delete("/artifacts/{artifact_id}")
def delete_artifact(tenant_id: str, artifact_id: str, user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id, "artifacts")
    db.execute("DELETE FROM artifacts WHERE id=%s AND tenant_id=%s", (artifact_id, tenant_id))
    log_activity(ctx, "artifact.deleted", {"artifactId": artifact_id})
    return {"ok": True}


@router.post("/artifacts/{artifact_id}/release")
def release_artifact(tenant_id: str, artifact_id: str, body: dict = Body(...), user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id, "deployment")
    artifact = db.fetch_one("SELECT * FROM artifacts WHERE id=%s AND tenant_id=%s", (artifact_id, tenant_id))
    if not artifact:
        raise HTTPException(404, "制品不存在")
    env = _env_or_404(tenant_id, body.get("environmentId"))
    return orchestration.deploy_artifact(ctx, artifact, env, body.get("notes"))


# --- pipelines -----------------------------------------------------------

@router.get("/pipelines")
def list_pipelines(
    tenant_id: str,
    limit: int = Query(default=200, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    user: dict = Depends(get_current_user),
):
    load_tenant_context(user, tenant_id, "pipelines")
    rows = db.fetch_all(
        "SELECT * FROM pipelines WHERE tenant_id=%s ORDER BY created_at DESC LIMIT %s OFFSET %s",
        (tenant_id, limit, offset),
    )
    return [serializers.pipeline(r) for r in rows]


@router.post("/pipelines")
def create_pipeline(tenant_id: str, body: dict = Body(...), user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id, "pipelines")
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "请输入流水线名称")
    project_id = body.get("projectId")
    if project_id and not db.fetch_one(
        "SELECT id FROM projects WHERE id=%s AND tenant_id=%s", (project_id, tenant_id)
    ):
        raise HTTPException(400, "项目不存在或不属于当前租户")
    row = db.execute_returning(
        """INSERT INTO pipelines (tenant_id, project_id, name, description, stages, trigger, created_by)
           VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING *""",
        (
            tenant_id, body.get("projectId"), name, body.get("description"),
            Json(body.get("stages") or []), body.get("trigger") or "manual", user["id"],
        ),
    )
    log_activity(ctx, "pipeline.created", {"name": name})
    return serializers.pipeline(row)


@router.delete("/pipelines/{pipeline_id}")
def delete_pipeline(tenant_id: str, pipeline_id: str, user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id, "pipelines")
    db.execute("DELETE FROM pipelines WHERE id=%s AND tenant_id=%s", (pipeline_id, tenant_id))
    log_activity(ctx, "pipeline.deleted", {"pipelineId": pipeline_id})
    return {"ok": True}


@router.post("/pipelines/{pipeline_id}/run")
def run_pipeline(tenant_id: str, pipeline_id: str, body: dict = Body(default={}), user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id, "pipelines")
    pipeline = db.fetch_one("SELECT * FROM pipelines WHERE id=%s AND tenant_id=%s", (pipeline_id, tenant_id))
    if not pipeline:
        raise HTTPException(404, "流水线不存在")
    return orchestration.run_pipeline(ctx, pipeline, body.get("artifactId"))


@router.get("/pipeline-runs")
def list_pipeline_runs(
    tenant_id: str,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    user: dict = Depends(get_current_user),
):
    load_tenant_context(user, tenant_id, "pipelines")
    rows = db.fetch_all(
        "SELECT * FROM pipeline_runs WHERE tenant_id=%s"
        " ORDER BY started_at DESC LIMIT %s OFFSET %s",
        (tenant_id, limit, offset),
    )
    return [serializers.pipeline_run(r) for r in rows]


# --- deployments ---------------------------------------------------------

@router.get("/deployments")
def list_deployments(
    tenant_id: str,
    limit: int = Query(default=200, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    user: dict = Depends(get_current_user),
):
    load_tenant_context(user, tenant_id, "deployment")
    rows = db.fetch_all(
        """SELECT d.*, a.name AS artifact_name FROM deployments d
           LEFT JOIN artifacts a ON a.id=d.artifact_id
           WHERE d.tenant_id=%s ORDER BY d.deployed_at DESC LIMIT %s OFFSET %s""",
        (tenant_id, limit, offset),
    )
    return [serializers.deployment(r) for r in rows]


@router.post("/deployments")
def create_deployment(tenant_id: str, body: dict = Body(...), user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id, "deployment")
    artifact = db.fetch_one(
        "SELECT * FROM artifacts WHERE id=%s AND tenant_id=%s", (body.get("artifactId"), tenant_id)
    )
    if not artifact:
        raise HTTPException(404, "制品不存在")
    env = _env_or_404(tenant_id, body.get("environmentId"))
    return orchestration.deploy_artifact(ctx, artifact, env, body.get("notes"))


# --- monitoring ----------------------------------------------------------

def _monitor_or_404(tenant_id: str, monitor_id: str) -> dict:
    row = db.fetch_one("SELECT * FROM monitors WHERE id=%s AND tenant_id=%s", (monitor_id, tenant_id))
    if not row:
        raise HTTPException(404, "监控项不存在")
    return row


def _validated_monitor_url(tenant_id: str, url: str) -> str:
    envs = db.fetch_all(
        "SELECT base_url, ip FROM environments WHERE tenant_id=%s", (tenant_id,)
    )
    try:
        return net_guard.validate_url(url, net_guard.targets_from_environments(envs))
    except net_guard.UnsafeTarget as e:
        raise HTTPException(400, f"监控地址不被允许：{e}") from e


@router.get("/monitors")
def list_monitors(
    tenant_id: str,
    limit: int = Query(default=200, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    user: dict = Depends(get_current_user),
):
    load_tenant_context(user, tenant_id, "monitoring")
    rows = db.fetch_all(
        """SELECT m.*, e.name AS environment_name FROM monitors m
           LEFT JOIN environments e ON e.id=m.environment_id
           WHERE m.tenant_id=%s ORDER BY m.created_at LIMIT %s OFFSET %s""",
        (tenant_id, limit, offset),
    )
    return [serializers.monitor(r) for r in rows]


@router.post("/monitors")
def create_monitor(tenant_id: str, body: dict = Body(...), user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id, "monitor.manage")
    env = None
    url = body.get("url")
    if body.get("environmentId"):
        env = _env_or_404(tenant_id, body["environmentId"])
        url = url or env.get("base_url") or (f"http://{env['ip']}" if env.get("ip") else None)
    if not url:
        raise HTTPException(400, "请提供监控 URL 或选择已配置访问地址的环境")
    url = _validated_monitor_url(tenant_id, url)
    name = (body.get("name") or "").strip() or f"{env['name'] if env else '服务'} 健康检查"
    row = db.execute_returning(
        """INSERT INTO monitors
           (tenant_id, environment_id, name, url, method, expected_status, interval_seconds, created_by)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING *""",
        (
            tenant_id, env["id"] if env else None, name, url, body.get("method") or "GET",
            body.get("expectedStatus") or 200, body.get("intervalSeconds") or 300, user["id"],
        ),
    )
    enriched = dict(row)
    enriched["environment_name"] = env["name"] if env else None
    log_activity(ctx, "monitor.created", {"name": name, "url": url})
    return serializers.monitor(enriched)


@router.patch("/monitors/{monitor_id}")
def update_monitor(tenant_id: str, monitor_id: str, body: dict = Body(...), user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id, "monitor.manage")
    m = _monitor_or_404(tenant_id, monitor_id)
    url = _validated_monitor_url(tenant_id, body.get("url") or m["url"])
    row = db.execute_returning(
        """UPDATE monitors SET name=%s, url=%s, method=%s, expected_status=%s, interval_seconds=%s
           WHERE id=%s RETURNING *""",
        (
            body.get("name") or m["name"], url,
            body.get("method", m["method"]), body.get("expectedStatus", m["expected_status"]),
            body.get("intervalSeconds", m["interval_seconds"]), monitor_id,
        ),
    )
    log_activity(ctx, "monitor.updated", {"name": row["name"]})
    return serializers.monitor(row)


@router.delete("/monitors/{monitor_id}")
def delete_monitor(tenant_id: str, monitor_id: str, user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id, "monitor.manage")
    m = _monitor_or_404(tenant_id, monitor_id)
    db.execute("DELETE FROM monitors WHERE id=%s", (monitor_id,))
    log_activity(ctx, "monitor.deleted", {"name": m["name"]})
    return {"ok": True}


@router.post("/monitors/{monitor_id}/check")
def check_monitor(tenant_id: str, monitor_id: str, user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id, "monitoring")
    m = _monitor_or_404(tenant_id, monitor_id)
    return orchestration.check_monitor(ctx, m)


@router.post("/monitors/check-all")
def check_all(tenant_id: str, user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id, "monitoring")
    rows = db.fetch_all("SELECT * FROM monitors WHERE tenant_id=%s", (tenant_id,))
    out = []
    for m in rows:
        try:
            out.append(orchestration.check_monitor(ctx, m))
        except Exception:
            pass
    return out


# --- alerts --------------------------------------------------------------

@router.get("/alerts")
def list_alerts(
    tenant_id: str,
    status: str | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    user: dict = Depends(get_current_user),
):
    load_tenant_context(user, tenant_id, "alerts")
    if status:
        rows = db.fetch_all(
            """SELECT al.*, m.name AS monitor_name FROM alerts al
               LEFT JOIN monitors m ON m.id=al.monitor_id
               WHERE al.tenant_id=%s AND al.status=%s
               ORDER BY al.created_at DESC LIMIT %s OFFSET %s""",
            (tenant_id, status, limit, offset),
        )
    else:
        rows = db.fetch_all(
            """SELECT al.*, m.name AS monitor_name FROM alerts al
               LEFT JOIN monitors m ON m.id=al.monitor_id
               WHERE al.tenant_id=%s ORDER BY al.created_at DESC LIMIT %s OFFSET %s""",
            (tenant_id, limit, offset),
        )
    return [serializers.alert(r) for r in rows]


@router.patch("/alerts/{alert_id}")
def update_alert(tenant_id: str, alert_id: str, body: dict = Body(...), user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id, "alerts")
    alert = db.fetch_one("SELECT * FROM alerts WHERE id=%s AND tenant_id=%s", (alert_id, tenant_id))
    if not alert:
        raise HTTPException(404, "告警不存在")
    status = body.get("status")
    if status not in ("open", "acknowledged", "resolved"):
        raise HTTPException(400, "无效的告警状态")
    ack_by = user["id"] if status == "acknowledged" else alert.get("acknowledged_by")
    ack_at = datetime.now(timezone.utc) if status == "acknowledged" else alert.get("acknowledged_at")
    row = db.execute_returning(
        """UPDATE alerts SET status=%s, acknowledged_by=%s, acknowledged_at=%s,
           resolved_at=CASE WHEN %s='resolved' THEN now() ELSE NULL END
           WHERE id=%s RETURNING *""",
        (status, ack_by, ack_at, status, alert_id),
    )
    log_activity(ctx, "alert.updated", {"alertId": alert_id, "status": status})
    return serializers.alert(row)
