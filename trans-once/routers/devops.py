"""Environments (human-managed IP/secrets), artifacts, CI/CD, deployments,
monitoring and alerting."""
from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from psycopg2.extras import Json

import alert_notify
import db
import net_guard
import notifiers
import orchestration
import serializers
import urllib.parse
import uuid
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


# --- alert channels ------------------------------------------------------

def _channel_or_404(tenant_id: str, channel_id: str) -> dict:
    row = db.fetch_one(
        "SELECT * FROM alert_channels WHERE id=%s AND tenant_id=%s", (channel_id, tenant_id)
    )
    if not row:
        raise HTTPException(404, "告警通道不存在")
    return row


def _uuid_list(values, label: str) -> list[str]:
    """校验每一项都是合法的 UUID 字符串，去重并保持传入顺序。"""
    out: list[str] = []
    for value in values or []:
        try:
            out.append(str(uuid.UUID(str(value))))
        except (ValueError, AttributeError, TypeError):
            raise HTTPException(400, f"{label}里有无效的 ID") from None
    return list(dict.fromkeys(out))


def _channel_fields(body: dict, current: dict | None) -> dict:
    """校验新建 / 修改通道的请求体，返回要写入的列。`current` 为 None 表示新建。"""
    base = current or {}
    name = (body.get("name") or base.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "请输入通道名称")
    if len(name) > 50:
        raise HTTPException(400, "通道名称不超过 50 个字")
    provider = body.get("provider") or base.get("provider")
    if provider not in notifiers.PROVIDERS:
        raise HTTPException(400, "不支持的平台，仅支持钉钉、企业微信、飞书")
    fields: dict = {"name": name, "provider": provider}
    webhook = (body.get("webhook") or "").strip()
    if webhook:
        # 内网地址放行（企业微信、飞书有私有化网关）：把地址自己的主机名放进白名单。
        host = (urllib.parse.urlsplit(webhook).hostname or "").strip("[]").lower()
        try:
            fields["webhook_enc"] = encrypt_secret(net_guard.validate_url(webhook, {host}))
        except net_guard.UnsafeTarget as e:
            raise HTTPException(400, f"Webhook 地址不被允许：{e}") from e
    elif current is None:
        raise HTTPException(400, "请输入 Webhook 地址")
    # 密钥三态：不传保留，空串清除，非空替换。
    if body.get("secret") is not None:
        secret = str(body["secret"]).strip()
        if secret and provider == "wecom":
            raise HTTPException(400, "企业微信群机器人不支持签名，无需填写密钥")
        fields["secret_enc"] = encrypt_secret(secret)
    if "enabled" in body:
        fields["enabled"] = bool(body.get("enabled"))
    if "events" in body:
        events = body.get("events")
        if not isinstance(events, dict) or set(events) - set(notifiers.EVENTS):
            raise HTTPException(400, "events 只能包含 monitor、manual、status")
        fields["events"] = {
            **notifiers.DEFAULT_EVENTS, **(base.get("events") or {}),
            **{key: bool(value) for key, value in events.items()},
        }
    return fields


@router.get("/alert-channels")
def list_alert_channels(tenant_id: str, user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id)
    # 只读接口：有告警中心权限即可（录入问题的弹窗要知道有没有可用通道）。
    if not (ctx.has("alerts") or ctx.has("alert.channel.manage")):
        raise HTTPException(403, "缺少权限: alerts")
    rows = db.fetch_all(
        "SELECT * FROM alert_channels WHERE tenant_id=%s ORDER BY created_at", (tenant_id,)
    )
    return [serializers.alert_channel(r) for r in rows]


@router.post("/alert-channels")
def create_alert_channel(tenant_id: str, body: dict = Body(...), user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id, "alert.channel.manage")
    fields = _channel_fields(body, None)
    row = db.execute_returning(
        """INSERT INTO alert_channels
           (tenant_id, name, provider, webhook_enc, secret_enc, enabled, events, created_by)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING *""",
        (
            tenant_id, fields["name"], fields["provider"], fields["webhook_enc"],
            fields.get("secret_enc"), fields.get("enabled", True),
            Json(fields.get("events") or notifiers.DEFAULT_EVENTS), user["id"],
        ),
    )
    log_activity(ctx, "alert.channel.created",
                 {"channelId": row["id"], "name": row["name"], "provider": row["provider"]})
    return serializers.alert_channel(row)


@router.patch("/alert-channels/{channel_id}")
def update_alert_channel(tenant_id: str, channel_id: str, body: dict = Body(...), user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id, "alert.channel.manage")
    channel = _channel_or_404(tenant_id, channel_id)
    fields = _channel_fields(body, channel)
    labels = {"name": "name", "provider": "provider", "webhook_enc": "webhook", "secret_enc": "secret",
              "enabled": "enabled", "events": "events"}
    changed = [
        labels[column] for column in fields
        if fields[column] != (channel.get("events") or {} if column == "events" else channel.get(column))
    ]
    assignments = ", ".join(f"{column}=%s" for column in fields) + ", updated_at=now()"
    values = [Json(fields[column]) if column == "events" else fields[column] for column in fields]
    row = db.execute_returning(
        f"UPDATE alert_channels SET {assignments} WHERE id=%s RETURNING *", (*values, channel_id)
    )
    log_activity(ctx, "alert.channel.updated",
                 {"channelId": channel_id, "name": row["name"], "fields": changed})
    return serializers.alert_channel(row)


@router.delete("/alert-channels/{channel_id}")
def delete_alert_channel(tenant_id: str, channel_id: str, user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id, "alert.channel.manage")
    channel = _channel_or_404(tenant_id, channel_id)
    db.execute("DELETE FROM alert_channels WHERE id=%s", (channel_id,))
    log_activity(ctx, "alert.channel.deleted", {"name": channel["name"], "provider": channel["provider"]})
    return {"ok": True}


@router.post("/alert-channels/{channel_id}/test")
def test_alert_channel(tenant_id: str, channel_id: str, user: dict = Depends(get_current_user)):
    ctx = load_tenant_context(user, tenant_id, "alert.channel.manage")
    channel = _channel_or_404(tenant_id, channel_id)
    row = alert_notify.send_test(tenant_id, channel, user["id"])
    log_activity(ctx, "alert.channel.tested",
                 {"channelId": channel_id, "name": channel["name"], "status": row["status"]})
    return serializers.alert_delivery(row)


@router.get("/alert-channels/deliveries")
def list_alert_deliveries(
    tenant_id: str,
    channelId: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=200),
    user: dict = Depends(get_current_user),
):
    load_tenant_context(user, tenant_id, "alert.channel.manage")
    sql = "SELECT * FROM alert_deliveries WHERE tenant_id=%s"
    args: list = [tenant_id]
    if channelId:
        sql += " AND channel_id=%s"
        args.append(channelId)
    sql += " ORDER BY created_at DESC LIMIT %s"
    args.append(limit)
    return [serializers.alert_delivery(r) for r in db.fetch_all(sql, tuple(args))]


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
