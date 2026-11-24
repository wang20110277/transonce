"""Deliver one alert event to the tenant's alert channels.

`notifiers.py` only knows how to talk to a single robot. This module decides
which robots to talk to (enabled and subscribed to the event), talks to them in
parallel and records every attempt in `alert_deliveries`. Both the routes and
`orchestration.check_monitor` call it, so it lives outside `routers/`.
"""
from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import db
import notifiers
from security import decrypt_secret

log = logging.getLogger("transonce")
MAX_WORKERS = 8


def to_user_ids(value) -> list[str]:
    """把 `alerts.notified_user_ids` 统一成字符串列表。

    这一列是 UUID[]，psycopg2 默认把它取成数组字面量字符串（例如 '{a,b}'，空数组是 '{}'），
    直接迭代会得到一个个字符。
    """
    if not value:
        return []
    if isinstance(value, str):
        return [part for part in value.strip("{}").split(",") if part]
    return [str(v) for v in value]


def notified_names(value) -> dict[str, str]:
    """users.id → 姓名，一次查询。`value` 是 `notified_user_ids` 列的值。"""
    ids = to_user_ids(value)
    if not ids:
        return {}
    rows = db.fetch_all("SELECT id, name FROM users WHERE id = ANY(%s::uuid[])", (ids,))
    return {str(r["id"]): r["name"] for r in rows}


def _describe(tenant_id: str, alert_id: str) -> dict | None:
    """消息里要写的全部内容，按告警 id 一次关联查询取齐。告警不属于这个租户时返回 None。"""
    row = db.fetch_one(
        """SELECT al.*, m.name AS monitor_name, e.name AS environment_name,
                  cb.name AS created_by_name, t.name AS tenant_name
           FROM alerts al
           LEFT JOIN monitors m ON m.id=al.monitor_id
           LEFT JOIN environments e ON e.id=al.environment_id
           LEFT JOIN users cb ON cb.id=al.created_by
           JOIN tenants t ON t.id=al.tenant_id
           WHERE al.id=%s AND al.tenant_id=%s""",
        (alert_id, tenant_id),
    )
    if row is None:
        return None
    ids = to_user_ids(row.get("notified_user_ids"))
    names = notified_names(ids)
    if row.get("source") == "manual":
        origin = f"{row.get('created_by_name') or '成员'} 录入"
    else:
        name = row.get("monitor_name")
        origin = f"监控「{name}」检查失败" if name else "监控检查失败"
    return {
        "tenant": row["tenant_name"],
        "title": row["title"],
        "severity": row.get("severity"),
        "origin": origin,
        "environment": row.get("environment_name"),
        "notified": [names[i] for i in ids if i in names],
        "created_at": row.get("created_at"),
        "detail": row.get("detail"),
        "status": row.get("status"),
    }


def notify(tenant_id: str, event: str, alert: dict, actor_id: str | None = None,
           channel_ids: list[str] | None = None) -> list[dict]:
    """把 `event` 推给符合条件的通道，并写推送记录。永不抛异常：群机器人出问题不能让产生告警的请求失败。

    返回新建的 `alert_deliveries` 行。`channel_ids` 只能缩小范围：None 表示推给所有符合条件的通道，
    显式传入空列表表示一个通道都不推。
    """
    try:
        if channel_ids is not None and len(channel_ids) == 0:
            return []
        channels = db.fetch_all(
            "SELECT * FROM alert_channels WHERE tenant_id=%s AND enabled ORDER BY created_at", (tenant_id,)
        )
        wanted = {str(c) for c in channel_ids or []}
        targets = [
            c for c in channels
            if (c.get("events") or {}).get(event) and (not wanted or str(c["id"]) in wanted)
        ]
        if not targets:
            return []
        described = _describe(tenant_id, str(alert["id"]))
        if described is None:
            log.warning("alert notification skipped, alert not in this tenant: tenant=%s event=%s alert=%s",
                        tenant_id, event, alert.get("id"))
            return []
        headline, lines = notifiers.compose(event, **described)

        def deliver(index: int) -> dict:
            channel = targets[index]
            try:
                return notifiers.send(
                    channel["provider"], decrypt_secret(channel["webhook_enc"]) or "",
                    decrypt_secret(channel["secret_enc"]), headline, lines,
                )
            except Exception as exc:  # 解密失败等：记为失败，不影响其它通道
                return {"status": "failed", "httpStatus": None,
                        "error": notifiers.sanitize_error(f"{type(exc).__name__}: {exc}"), "durationMs": 0}

        with ThreadPoolExecutor(max_workers=min(MAX_WORKERS, len(targets))) as pool:
            results = list(pool.map(deliver, range(len(targets))))

        rows = []
        for channel, result in zip(targets, results):
            rows.append(db.execute_returning(
                """INSERT INTO alert_deliveries
                   (tenant_id, alert_id, channel_id, channel_name, provider, event, status,
                    http_status, error, duration_ms, created_by)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING *""",
                (
                    tenant_id, alert["id"], channel["id"], channel["name"], channel["provider"], event,
                    result["status"], result["httpStatus"], result["error"], result["durationMs"], actor_id,
                ),
            ))
        return rows
    except Exception:
        log.exception("alert notification failed: tenant=%s event=%s alert=%s",
                      tenant_id, event, alert.get("id"))
        return []


def send_test(tenant_id: str, channel: dict, actor_id: str | None) -> dict:
    """用这个通道发一条固定的测试消息并记入推送记录。通道停用时也可以发。"""
    tenant = db.fetch_one("SELECT name FROM tenants WHERE id=%s", (tenant_id,))
    headline, lines = notifiers.compose(
        "monitor", tenant=tenant["name"], title="测试消息", origin=f"告警通道「{channel['name']}」",
        created_at=datetime.now(timezone.utc),
    )
    lines.append("收到这条消息说明配置正确。")
    result = notifiers.send(
        channel["provider"], decrypt_secret(channel["webhook_enc"]) or "",
        decrypt_secret(channel["secret_enc"]), headline, lines,
    )
    return db.execute_returning(
        """INSERT INTO alert_deliveries
           (tenant_id, alert_id, channel_id, channel_name, provider, event, status,
            http_status, error, duration_ms, created_by)
           VALUES (%s, NULL, %s, %s, %s, 'test', %s, %s, %s, %s, %s) RETURNING *""",
        (
            tenant_id, channel["id"], channel["name"], channel["provider"], result["status"],
            result["httpStatus"], result["error"], result["durationMs"], actor_id,
        ),
    )
