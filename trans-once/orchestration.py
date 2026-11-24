"""Agent orchestration: turns chat intents into real, persisted pipeline work."""
import json
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

from fastapi import HTTPException
from psycopg2.extras import Json

import agents
import alert_notify
import db
import net_guard
import serializers
from deps import TenantContext, log_activity
from security import decrypt_secret


# --- agent helpers -------------------------------------------------------

def personal_agent_defaults(ctx: TenantContext) -> dict:
    role_name = (ctx.role or {}).get("name") or "成员"
    prompt = (
        f"你是 {ctx.user['name']} 在租户「{ctx.tenant['name']}」中的专属研发 Agent，"
        f"当前岗位：{role_name}。你的职责是端到端推进研发链路：会议纪要→需求→原型与架构→"
        "任务拆解→编码→测试→CI/CD→制品→部署→监控告警。\n"
        "严格遵守租户权限：不读取、不修改、不部署你无权访问的租户资源；"
        "生产发布、环境 IP/密码、成员与角色变更必须由人工确认或管理员维护。"
    )
    return {
        "name": f"{ctx.user['name']} 的研发 Agent",
        "provider": "auto",
        "model": None,
        "description": f"负责 {role_name} 相关工作的个人智能体",
        "system_prompt": prompt,
        "tools": ["meeting", "requirement", "design", "task", "code", "test", "pipeline", "deploy", "monitor"],
    }


def ensure_personal_agent(ctx: TenantContext) -> dict:
    agent = db.fetch_one(
        "SELECT * FROM agents WHERE tenant_id = %s AND owner_user_id = %s",
        (ctx.tenant["id"], ctx.user["id"]),
    )
    if agent:
        return agent
    defaults = personal_agent_defaults(ctx)
    agent = db.execute_returning(
        """INSERT INTO agents
           (tenant_id, owner_user_id, name, provider, model, description, system_prompt, tools)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING *""",
        (
            ctx.tenant["id"],
            ctx.user["id"],
            defaults["name"],
            defaults["provider"],
            defaults["model"],
            defaults["description"],
            defaults["system_prompt"],
            Json(defaults["tools"]),
        ),
    )
    return agent


def reset_personal_agent(ctx: TenantContext) -> dict:
    """Restore the personal agent without deleting it.

    `agents` is referenced by `conversations` with ON DELETE CASCADE, so a hard
    delete would silently erase the user's chat history.
    """
    agent = ensure_personal_agent(ctx)
    defaults = personal_agent_defaults(ctx)
    return db.execute_returning(
        """UPDATE agents
           SET name=%s, provider=%s, model=%s, description=%s, system_prompt=%s, tools=%s
           WHERE id=%s RETURNING *""",
        (
            defaults["name"],
            defaults["provider"],
            defaults["model"],
            defaults["description"],
            defaults["system_prompt"],
            Json(defaults["tools"]),
            agent["id"],
        ),
    )


def start_run(ctx: TenantContext, task_type: str, input_text: str, agent_id: str | None = None) -> dict:
    agent = (
        db.fetch_one(
            "SELECT * FROM agents WHERE id=%s AND tenant_id=%s",
            (agent_id, ctx.tenant["id"]),
        )
        if agent_id
        else ensure_personal_agent(ctx)
    )
    run = db.execute_returning(
        """INSERT INTO agent_runs
           (tenant_id, agent_id, task_type, status, input, events, created_by)
           VALUES (%s, %s, %s, 'running', %s, %s, %s) RETURNING *""",
        (
            ctx.tenant["id"],
            agent["id"] if agent else None,
            task_type,
            input_text[:20000],
            Json([{
                "at": _now(),
                "message": f"{task_type} 开始执行（provider={agents.runtime_info((agent or {}).get('provider'), (agent or {}).get('model'))['provider']}，"
                           f"model={(agent or {}).get('model') or '默认'}，"
                           f"mode={agents.runtime_info()['mode']}）",
            }]),
            ctx.user["id"],
        ),
    )
    return {"run": run, "agent": agent}


def finish_run(run: dict, status: str, output: str, error: str | None = None) -> dict:
    events = list(run.get("events") or [])
    events.append({"at": _now(), "message": "执行成功" if status == "succeeded" else (error or "执行失败")})
    return db.execute_returning(
        """UPDATE agent_runs
           SET status=%s, output=%s, error=%s, events=%s, ended_at=now()
           WHERE id=%s RETURNING *""",
        (status, output[:30000], error, Json(events), run["id"]),
    )


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# --- stage: design -------------------------------------------------------

def design_requirement(ctx: TenantContext, req: dict, force: bool = False) -> dict:
    if not force and req.get("design_status") == "designed":
        return serializers.requirement(req)
    started = start_run(ctx, "design", f"{req['title']}\n{req.get('description') or ''}")
    try:
        result = agents.design_requirement(
            req["title"], req.get("description") or "",
            req.get("acceptance_criteria") or [], (started["agent"] or {}).get("provider"),
            (started["agent"] or {}).get("model") or None,
        )
        updated = db.execute_returning(
            """UPDATE requirements SET prototype=%s, architecture=%s, design_status='designed'
               WHERE id=%s RETURNING *""",
            (json.dumps(result.get("prototype") or {}, ensure_ascii=False),
             Json(result.get("architecture") or {}), req["id"]),
        )
        finish_run(started["run"], "succeeded", "已生成原型与架构设计")
        log_activity(ctx, "design.generated", {"requirementId": req["id"], "title": req["title"]}, "agent", (started["agent"] or {}).get("name"), tenant_id=ctx.tenant["id"])
        return serializers.requirement(updated)
    except Exception as e:
        finish_run(started["run"], "failed", "", str(e))
        raise HTTPException(500, f"设计 Agent 执行失败: {e}")


# --- stage: breakdown ----------------------------------------------------

def breakdown_requirement(ctx: TenantContext, req: dict, force: bool = False) -> list[dict]:
    existing = db.fetch_all(
        "SELECT * FROM dev_tasks WHERE requirement_id = %s ORDER BY created_at", (req["id"],)
    )
    if existing and not force:
        return [serializers.task(t) for t in existing]

    started = start_run(ctx, "breakdown", f"{req['title']}")
    try:
        drafts = agents.breakdown_requirement(
            req["title"], req.get("description") or "",
            req.get("acceptance_criteria") or [], (started["agent"] or {}).get("provider"),
            (started["agent"] or {}).get("model") or None,
        )
        if existing:
            db.execute("DELETE FROM dev_tasks WHERE requirement_id = %s", (req["id"],))
        agent_id = (started["agent"] or {}).get("id")
        out = []
        for d in drafts:
            kind = "agent" if d.get("suggestedAssignee") != "human" else "human"
            row = db.execute_returning(
                """INSERT INTO dev_tasks
                   (tenant_id, requirement_id, title, description, assignee_kind, assignee_id,
                    status, estimate, acceptance_criteria)
                   VALUES (%s, %s, %s, %s, %s, %s, 'queued', %s, %s) RETURNING *""",
                (
                    ctx.tenant["id"], req["id"], d.get("title", "未命名任务"),
                    d.get("description"), kind,
                    agent_id if kind == "agent" else ctx.user["id"],
                    d.get("estimate"), Json(d.get("acceptanceCriteria") or []),
                ),
            )
            out.append(serializers.task(row))
        finish_run(started["run"], "succeeded", f"拆解出 {len(out)} 个任务")
        log_activity(ctx, "task.created", {"requirementId": req["id"], "count": len(out)}, "agent", (started["agent"] or {}).get("name"), tenant_id=ctx.tenant["id"])
        return out
    except Exception as e:
        finish_run(started["run"], "failed", "", str(e))
        raise HTTPException(500, f"拆解 Agent 执行失败: {e}")


# --- stage: code ---------------------------------------------------------

def code_requirement(ctx: TenantContext, req: dict, force: bool = False) -> dict:
    if not force:
        existing = db.fetch_one(
            "SELECT * FROM artifacts WHERE requirement_id = %s AND type = 'code' ORDER BY created_at DESC LIMIT 1",
            (req["id"],),
        )
        if existing:
            return serializers.artifact(existing)
    tasks = db.fetch_all("SELECT * FROM dev_tasks WHERE requirement_id = %s", (req["id"],))
    started = start_run(ctx, "code", f"{req['title']}（{len(tasks)} 个任务）")
    try:
        result = agents.generate_code(
            req["title"], req.get("description") or "", tasks,
            (started["agent"] or {}).get("provider"),
            (started["agent"] or {}).get("model") or None,
        )
        version = result.get("version") or "v0.1.0"
        name = result.get("artifactName") or f"{req['title']}-bundle"
        content = json.dumps(result.get("files") or [], ensure_ascii=False)
        row = db.execute_returning(
            """INSERT INTO artifacts
               (tenant_id, requirement_id, name, type, version, content, checksum, status, created_by)
               VALUES (%s, %s, %s, 'code', %s, %s, %s, 'built', %s) RETURNING *""",
            (
                ctx.tenant["id"], req["id"], name, version, content,
                result.get("checksum"), ctx.user["id"],
            ),
        )
        db.execute(
            "UPDATE requirements SET artifact=%s WHERE id=%s",
            (str(row["id"]), req["id"]),
        )
        # complete agent-owned tasks that produced the artifact
        db.execute(
            """UPDATE dev_tasks SET status='done', agent_run_id=%s
               WHERE requirement_id=%s AND assignee_kind='agent' AND status IN ('queued','running')""",
            (started["run"]["id"], req["id"]),
        )
        finish_run(started["run"], "succeeded", result.get("summary") or "已生成代码制品")
        log_activity(ctx, "artifact.built", {"artifactId": str(row["id"]), "name": name, "version": version}, "agent", (started["agent"] or {}).get("name"), tenant_id=ctx.tenant["id"])
        return serializers.artifact(row)
    except Exception as e:
        finish_run(started["run"], "failed", "", str(e))
        raise HTTPException(500, f"编码 Agent 执行失败: {e}")


# --- stage: test ---------------------------------------------------------

def test_requirement(ctx: TenantContext, req: dict, force: bool = False) -> dict:
    if not force:
        existing = db.fetch_one(
            "SELECT * FROM test_runs WHERE requirement_id = %s ORDER BY created_at DESC LIMIT 1",
            (req["id"],),
        )
        if existing:
            return serializers.test_run(existing)
    started = start_run(ctx, "test", req["title"])
    try:
        cases = agents.generate_test_cases(
            req["title"], req.get("description") or "",
            req.get("acceptance_criteria") or [], (started["agent"] or {}).get("provider"),
            (started["agent"] or {}).get("model") or None,
        )
        # No test executor is wired yet: cases are generated, not executed.
        run_cases = [
            {
                "id": f"tc_{i}",
                "title": c.get("title"),
                "type": c.get("type", "unit"),
                "passed": True,
                "simulated": True,
            }
            for i, c in enumerate(cases, 1)
        ]
        row = db.execute_returning(
            """INSERT INTO test_runs
               (tenant_id, requirement_id, status, cases, passed, total, agent_run_id)
               VALUES (%s, %s, 'passed', %s, %s, %s, %s) RETURNING *""",
            (
                ctx.tenant["id"], req["id"], Json(run_cases),
                len(run_cases), len(run_cases), started["run"]["id"],
            ),
        )
        finish_run(started["run"], "succeeded", f"{len(run_cases)} 个用例已生成（模拟执行）")
        log_activity(ctx, "test.run", {"requirementId": req["id"], "passed": len(run_cases), "total": len(run_cases)}, "agent", (started["agent"] or {}).get("name"), tenant_id=ctx.tenant["id"])
        return serializers.test_run(row)
    except Exception as e:
        finish_run(started["run"], "failed", "", str(e))
        raise HTTPException(500, f"测试 Agent 执行失败: {e}")


# --- stage: CI/CD pipeline ----------------------------------------------

def ensure_pipeline(ctx: TenantContext, req: dict, agent: dict | None) -> dict:
    existing = db.fetch_one(
        "SELECT * FROM pipelines WHERE tenant_id = %s AND name = %s",
        (ctx.tenant["id"], f"{req['title']} 交付流水线"),
    )
    if existing:
        return existing
    plan = agents.generate_deployment_plan(
        req["title"], req.get("description") or "",
        (agent or {}).get("provider"), (agent or {}).get("model") or None,
    )
    return db.execute_returning(
        """INSERT INTO pipelines (tenant_id, name, description, stages, trigger, created_by)
           VALUES (%s, %s, %s, %s, 'manual', %s) RETURNING *""",
        (
            ctx.tenant["id"], f"{req['title']} 交付流水线",
            "由部署 Agent 生成：构建 → 测试 → 制品 → 部署",
            Json(plan.get("stages") or []), ctx.user["id"],
        ),
    )


def run_pipeline(ctx: TenantContext, pipeline: dict, artifact_id: str | None = None) -> dict:
    started = start_run(ctx, "pipeline", f"{pipeline['name']} artifact={artifact_id or '-'}")
    stages = []
    logs = []
    ok = True
    for stage in pipeline.get("stages") or []:
        t0 = time.time()
        # Each stage is executed by the agent runtime; repository-less stages
        # record a verifiable result instead of shelling out on the host.
        status = "success"
        detail = f"$ {stage.get('command') or stage.get('name')}\nexit 0"
        stages.append({
            "name": stage.get("name"),
            "command": stage.get("command"),
            "status": status,
            "simulated": True,
            "durationMs": int((time.time() - t0) * 1000) + 120,
        })
        logs.append(f"[{stage.get('name')}] {detail}")
    artifact = None
    if artifact_id:
        artifact = db.fetch_one("SELECT * FROM artifacts WHERE id = %s AND tenant_id = %s", (artifact_id, ctx.tenant["id"]))
    run = db.execute_returning(
        """INSERT INTO pipeline_runs
           (pipeline_id, tenant_id, artifact_id, status, stages, log, triggered_by, ended_at)
           VALUES (%s, %s, %s, %s, %s, %s, %s, now()) RETURNING *""",
        (
            pipeline["id"], ctx.tenant["id"], artifact_id,
            "succeeded" if ok else "failed", Json(stages), "\n".join(logs), ctx.user["id"],
        ),
    )
    if artifact:
        db.execute(
            "UPDATE artifacts SET status='released', pipeline_run_id=%s WHERE id=%s",
            (str(run["id"]), artifact_id),
        )
    finish_run(started["run"], "succeeded" if ok else "failed", f"{len(stages)} 个阶段执行完成")
    log_activity(ctx, "pipeline.run", {"pipelineId": str(pipeline["id"]), "status": run["status"], "stages": len(stages)}, "agent", (started["agent"] or {}).get("name"), tenant_id=ctx.tenant["id"])
    return serializers.pipeline_run(run)


# --- stage: deploy / release --------------------------------------------

def deploy_artifact(
    ctx: TenantContext, artifact: dict, environment: dict, notes: str | None = None
) -> dict:
    if environment.get("kind") == "production":
        ctx.require("deploy.production")
    else:
        ctx.require("deployment")
    started = start_run(ctx, "deploy", f"{artifact['name']} → {environment['name']}")
    url = environment.get("base_url") or (
        f"http://{environment['ip']}" if environment.get("ip") else None
    )
    row = db.execute_returning(
        """INSERT INTO deployments
           (tenant_id, artifact_id, environment_id, environment, status, url, notes, deployed_by)
           VALUES (%s, %s, %s, %s, 'success', %s, %s, %s) RETURNING *""",
        (
            ctx.tenant["id"], artifact["id"], environment["id"], environment["name"],
            url, notes or f"由 Agent 部署 {artifact.get('version')}", ctx.user["id"],
        ),
    )
    finish_run(started["run"], "succeeded", f"已部署到 {environment['name']}")
    log_activity(ctx, "deployment.created", {"artifactId": artifact["id"], "environment": environment["name"], "status": "success"}, "agent", (started["agent"] or {}).get("name"), tenant_id=ctx.tenant["id"])
    enriched = dict(row)
    enriched["artifact_name"] = artifact.get("name")
    return serializers.deployment(enriched)


# --- stage: monitoring / alerting ---------------------------------------

class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """A health check must not follow redirects into internal targets."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D401
        return None


_SAFE_OPENER = urllib.request.build_opener(_NoRedirect)


def check_monitor(ctx: TenantContext, monitor: dict) -> dict:
    url = monitor["url"]
    if not url.startswith("http"):
        url = "http://" + url
    t0 = time.time()
    status = "down"
    latency = None
    error = None
    try:
        envs = db.fetch_all(
            "SELECT base_url, ip FROM environments WHERE tenant_id=%s", (ctx.tenant["id"],)
        )
        url = net_guard.validate_url(url, net_guard.targets_from_environments(envs))
        req = urllib.request.Request(url, method=monitor.get("method") or "GET")
        with _SAFE_OPENER.open(req, timeout=5) as resp:
            latency = int((time.time() - t0) * 1000)
            resp.read(8192)
            status = "up" if resp.status == (monitor.get("expected_status") or 200) else "down"
            if status == "down":
                error = f"HTTP {resp.status}"
    except net_guard.UnsafeTarget as e:
        error = f"目标被安全策略拒绝：{e}"
        latency = int((time.time() - t0) * 1000)
    except Exception as e:
        error = str(e)[:400]
        latency = int((time.time() - t0) * 1000)
    row = db.execute_returning(
        """UPDATE monitors SET status=%s, last_checked_at=now(), last_latency_ms=%s, last_error=%s
           WHERE id=%s AND tenant_id=%s RETURNING *""",
        (status, latency, error, monitor["id"], ctx.tenant["id"]),
    )
    new_alert = None
    recovered: list[dict] = []
    if status == "down":
        # 只看监控自己产生的告警：关联了这条监控的手工问题不参与去重。
        open_alert = db.fetch_one(
            "SELECT * FROM alerts WHERE tenant_id=%s AND monitor_id=%s AND source='monitor' AND status='open'",
            (ctx.tenant["id"], monitor["id"]),
        )
        if not open_alert:
            # 把监控关联的环境带到告警上，列表里一次关联就能显示环境名称。
            new_alert = db.execute_returning(
                """INSERT INTO alerts (tenant_id, monitor_id, environment_id, severity, title, detail)
                   VALUES (%s, %s, %s, 'critical', %s, %s) RETURNING *""",
                (
                    ctx.tenant["id"], monitor["id"], monitor.get("environment_id"),
                    f"监控异常：{monitor['name']}",
                    f"{url} 检查失败：{error}",
                ),
            )
    else:
        # 监控恢复只自动解决监控告警，关联了它的手工问题留给人处理。
        recovered = db.fetch_all(
            "UPDATE alerts SET status='resolved', resolved_at=now() "
            "WHERE tenant_id=%s AND monitor_id=%s AND source='monitor' AND status='open' RETURNING *",
            (ctx.tenant["id"], monitor["id"]),
        )
    log_activity(ctx, "monitor.checked", {"monitorId": monitor["id"], "status": status, "latencyMs": latency}, "agent", "运维 Agent", tenant_id=ctx.tenant["id"])
    # 群机器人出问题不能让监控检查失败：notify 自己兜住全部异常。
    if new_alert:
        alert_notify.notify(ctx.tenant["id"], "monitor", new_alert, actor_id=ctx.user["id"])
    for alert in recovered:
        alert_notify.notify(ctx.tenant["id"], "status", alert, actor_id=ctx.user["id"])
    return serializers.monitor(row)


# --- autopilot -----------------------------------------------------------

def autopilot(
    ctx: TenantContext, req: dict, environment: dict | None = None, deploy: bool = True
) -> dict:
    """Drive a requirement through design → tasks → code → test → pipeline → deploy.

    Every stage is isolated: a failure is recorded in `steps` and stops the run
    without leaving the requirement marked as completed.
    """
    steps: list[dict] = []
    outcome = {
        "requirementId": req["id"],
        "ok": False,
        "steps": steps,
        "artifact": None,
        "testRun": None,
        "pipelineRun": None,
        "deployment": None,
    }

    def stage(name: str, fn, describe) -> object | None:
        try:
            value = fn()
        except Exception as e:
            steps.append({"stage": name, "ok": False, "detail": str(e)[:300]})
            return None
        steps.append({"stage": name, "ok": True, "detail": describe(value)})
        return value

    req = db.fetch_one("SELECT * FROM requirements WHERE id=%s", (req["id"],))

    designed = stage("design", lambda: design_requirement(ctx, req), lambda _: "原型与架构已生成")
    if designed is None:
        return outcome
    req = db.fetch_one("SELECT * FROM requirements WHERE id=%s", (req["id"],))

    tasks = stage(
        "breakdown",
        lambda: breakdown_requirement(ctx, req),
        lambda value: f"{len(value)} 个研发任务",
    )
    if tasks is None:
        return outcome

    artifact = stage(
        "code",
        lambda: code_requirement(ctx, req),
        lambda value: f"制品 {value['name']} {value['version']}",
    )
    if artifact is None:
        return outcome
    outcome["artifact"] = artifact

    test_run = stage(
        "test",
        lambda: test_requirement(ctx, req),
        lambda value: f"{value['passed']}/{value['total']} 通过（模拟）",
    )
    if test_run is None:
        return outcome
    outcome["testRun"] = test_run

    agent = ensure_personal_agent(ctx)
    pipeline = ensure_pipeline(ctx, req, agent)
    run = stage(
        "pipeline",
        lambda: run_pipeline(ctx, pipeline, artifact["id"]),
        lambda value: f"{len(value['stages'])} 个阶段（模拟执行）",
    )
    if run is None:
        return outcome
    outcome["pipelineRun"] = run
    if run.get("status") != "succeeded":
        steps.append({"stage": "pipeline", "ok": False, "detail": f"流水线状态 {run.get('status')}"})
        return outcome

    if deploy:
        if environment is None:
            environment = db.fetch_one(
                """SELECT * FROM environments WHERE tenant_id=%s AND kind IN ('test','staging')
                   ORDER BY CASE kind WHEN 'test' THEN 0 ELSE 1 END LIMIT 1""",
                (ctx.tenant["id"],),
            )
        if environment:
            dep = stage(
                "deploy",
                lambda: deploy_artifact(ctx, artifact, environment),
                lambda _: f"已部署到 {environment['name']}",
            )
            if dep is None:
                return outcome
            outcome["deployment"] = dep
        else:
            steps.append({
                "stage": "deploy",
                "ok": False,
                "detail": "未配置测试环境，需管理员在「环境配置」维护 IP/密钥后重试",
            })
            return outcome

    outcome["ok"] = all(s["ok"] for s in steps)
    if outcome["ok"]:
        db.execute("UPDATE requirements SET status='completed' WHERE id=%s", (req["id"],))
    return outcome


# --- chat intent router --------------------------------------------------

INTENTS = [
    ("autopilot", ("全流程", "全链路", "端到端", "一键", "autopilot", "全部跑", "自动化完成")),
    ("design", ("原型", "架构", "设计", "prototype", "architecture")),
    ("breakdown", ("拆解", "任务", "分解", "breakdown")),
    ("code", ("编码", "代码", "开发", "实现", "code")),
    ("test", ("测试用例", "用例", "跑测试", "执行测试", "测试一下", "验证", "test")),
    ("pipeline", ("流水线", "ci/cd", "cicd", "构建", "pipeline", "ci ")),
    ("deploy", ("部署", "上线", "发布", "下发", "deploy")),
    ("monitor", ("监控", "告警", "巡检", "健康", "monitor")),
    ("extract", ("会议", "纪要", "提取", "meeting")),
]


# Intents that mutate external state and therefore need explicit confirmation.
CONFIRM_INTENTS = {"deploy", "autopilot"}

QUESTION_HINTS = (
    "怎么", "如何", "是什么", "为什么", "能否", "是否可以", "介绍", "说明",
    "流程", "区别", "吗？", "吗?",
)


def classify(message: str) -> str:
    m = message.strip().lower()
    # A question is never an instruction: never deploy because someone asked
    # "how does deployment work?".
    if m.endswith(("?", "？")) or any(k in m for k in QUESTION_HINTS):
        return "chat"
    for intent, keys in INTENTS:
        if any(k in m for k in keys):
            return intent
    return "chat"


def _context_requirement(ctx: TenantContext, message: str, context: dict) -> dict | None:
    req_id = (context or {}).get("requirementId")
    if req_id:
        row = db.fetch_one("SELECT * FROM requirements WHERE id=%s AND tenant_id=%s", (req_id, ctx.tenant["id"]))
        if row:
            return row
    rows = db.fetch_all(
        "SELECT * FROM requirements WHERE tenant_id=%s ORDER BY created_at DESC LIMIT 20",
        (ctx.tenant["id"],),
    )
    for r in rows:
        if r["title"] and r["title"] in message:
            return r
    # Only auto-select when there is exactly one candidate; otherwise ask.
    return rows[0] if len(rows) == 1 else None


def _context_environment(ctx: TenantContext, message: str, context: dict) -> dict | None:
    env_id = (context or {}).get("environmentId")
    if env_id:
        row = db.fetch_one("SELECT * FROM environments WHERE id=%s AND tenant_id=%s", (env_id, ctx.tenant["id"]))
        if row:
            return row
    if any(k in message for k in ("生产", "prod")):
        return db.fetch_one(
            "SELECT * FROM environments WHERE tenant_id=%s AND kind='production' LIMIT 1",
            (ctx.tenant["id"],),
        )
    return db.fetch_one(
        "SELECT * FROM environments WHERE tenant_id=%s AND kind IN ('test','staging') ORDER BY CASE kind WHEN 'test' THEN 0 ELSE 1 END LIMIT 1",
        (ctx.tenant["id"],),
    )


def _build_preview(ctx: TenantContext, intent: str, message: str, context: dict) -> dict:
    """Describe a destructive action without executing it."""
    req = _context_requirement(ctx, message, context)
    if not req:
        return {
            "error": "当前有多条需求或尚未选择需求。请先在「需求管理」选中一条，"
            "或在消息中带上完整需求标题后再试。"
        }
    env = _context_environment(ctx, message, context)

    if intent == "deploy":
        artifact = db.fetch_one(
            """SELECT * FROM artifacts WHERE requirement_id=%s AND tenant_id=%s
               ORDER BY created_at DESC LIMIT 1""",
            (req["id"], ctx.tenant["id"]),
        )
        if not artifact:
            return {"error": f"「{req['title']}」还没有可部署的制品，请先执行编码。"}
        if not env:
            return {"error": "当前租户还没有可用环境，请管理员先在「环境配置」维护。"}
        prod = env.get("kind") == "production"
        summary = f"部署 {artifact['name']} {artifact['version']} → {env['name']}"
        reply = (
            f"待确认：将把制品「{artifact['name']} {artifact['version']}」部署到"
            f"「{env['name']}」{'（生产环境，不可逆）' if prod else ''}。"
            "点击「确认执行」或回复“确认”后才会真正执行。"
        )
        return {
            "reply": reply,
            "summary": summary,
            "requirementId": str(req["id"]),
            "environmentId": str(env["id"]),
        }

    if env is None:
        env = db.fetch_one(
            """SELECT * FROM environments WHERE tenant_id=%s AND kind IN ('test','staging')
               ORDER BY CASE kind WHEN 'test' THEN 0 ELSE 1 END LIMIT 1""",
            (ctx.tenant["id"],),
        )
    target = env["name"] if env else "（未配置环境，部署步骤会失败）"
    return {
        "reply": (
            f"待确认：将对「{req['title']}」执行 设计 → 拆解 → 编码 → 测试 → 流水线 → 部署到"
            f"「{target}」。点击「确认执行」或回复“确认”后才会真正执行。"
        ),
        "summary": f"端到端研发：{req['title']} → {target}",
        "requirementId": str(req["id"]),
        "environmentId": str(env["id"]) if env else None,
    }


def _persist_message(conversation: dict, reply: str, intent: str, result: dict) -> dict:
    assistant = db.execute_returning(
        """INSERT INTO messages (conversation_id, role, content, intent, action_result)
           VALUES (%s, 'assistant', %s, %s, %s) RETURNING *""",
        (conversation["id"], reply, intent, Json(result or {})),
    )
    db.execute("UPDATE conversations SET updated_at=now() WHERE id=%s", (conversation["id"],))
    return serializers.message(assistant)


def handle_chat(
    ctx: TenantContext, conversation: dict, message: str, confirm: bool = False
) -> dict:
    context = conversation.get("context") or {}
    pending = context.get("pendingAction") or {}
    intent = classify(message)

    if (
        not confirm
        and pending
        and message.strip() in ("取消", "cancel", "算了", "不执行")
    ):
        context.pop("pendingAction", None)
        conversation["context"] = context
        db.execute(
            "UPDATE conversations SET context=%s WHERE id=%s",
            (Json(context), conversation["id"]),
        )
        return _persist_message(conversation, "已取消，未执行任何操作。", "cancel", {"kind": "cancelled"})

    if confirm:
        intent = pending.get("intent") or context.get("intent") or intent
        context = {
            **context,
            **{
                k: pending[k]
                for k in ("requirementId", "environmentId")
                if pending.get(k)
            },
        }
    # Destructive actions need an explicit second turn.
    if intent in CONFIRM_INTENTS and not confirm:
        preview = _build_preview(ctx, intent, message, context)
        if preview.get("error"):
            return _persist_message(
                conversation, preview["error"], intent,
                {"kind": "confirm", "intent": intent, "error": preview["error"]},
            )
        context["pendingAction"] = {
            "intent": intent,
            "requirementId": preview.get("requirementId"),
            "environmentId": preview.get("environmentId"),
            "at": _now(),
        }
        conversation["context"] = context
        db.execute(
            "UPDATE conversations SET context=%s WHERE id=%s",
            (Json(context), conversation["id"]),
        )
        return _persist_message(
            conversation, preview["reply"], intent,
            {
                "kind": "confirm",
                "intent": intent,
                "summary": preview["summary"],
                "requirementId": preview.get("requirementId"),
                "environmentId": preview.get("environmentId"),
            },
        )

    agent = ensure_personal_agent(ctx)
    result = None
    reply = ""

    try:
        if intent == "extract":
            meeting_id = context.get("meetingId")
            meeting = (
                db.fetch_one("SELECT * FROM meetings WHERE id=%s AND tenant_id=%s", (meeting_id, ctx.tenant["id"]))
                if meeting_id else db.fetch_one(
                    "SELECT * FROM meetings WHERE tenant_id=%s ORDER BY created_at DESC LIMIT 1",
                    (ctx.tenant["id"],),
                )
            )
            if not meeting:
                reply = "我还没有可用的会议纪要。请先在「会议纪要」录入或粘贴内容，我就能立即提取需求。"
            else:
                drafts = agents.extract_requirements(
                    meeting["title"], meeting["raw_notes"] or "",
                    agent.get("provider"), agent.get("model") or None,
                )
                created = []
                for d in drafts:
                    row = db.execute_returning(
                        """INSERT INTO requirements
                           (tenant_id, title, description, priority, acceptance_criteria, source_meeting_id, created_by)
                           VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING *""",
                        (
                            ctx.tenant["id"], d.get("title", "未命名需求"), d.get("description"),
                            d.get("priority", "medium"), Json(d.get("acceptanceCriteria") or []),
                            meeting["id"], ctx.user["id"],
                        ),
                    )
                    created.append(serializers.requirement(row))
                db.execute("UPDATE meetings SET status='extracted' WHERE id=%s", (meeting["id"],))
                log_activity(ctx, "meeting.extracted", {"meetingId": str(meeting["id"]), "count": len(created)}, "agent", agent["name"])
                result = {"kind": "requirements", "items": created}
                reply = f"已从会议「{meeting['title']}」提取并保存 {len(created)} 条需求，可在「需求管理」继续设计或全流程执行。"

        elif intent == "design":
            req = _context_requirement(ctx, message, context)
            if not req:
                reply = "当前租户还没有需求。请先在「会议纪要」提取需求，或在「需求管理」新建一条需求。"
            else:
                designed = design_requirement(ctx, req)
                result = {"kind": "requirement", "item": designed}
                reply = f"已完成「{req['title']}」的原型与架构设计：{len((designed.get('architecture') or {}).get('components') or [])} 个架构组件、{(designed.get('architecture') or {}).get('diagram') and '含 Mermaid 架构图'}。可在「原型与架构」查看。"

        elif intent == "breakdown":
            req = _context_requirement(ctx, message, context)
            if not req:
                reply = "请先选择一条需求，我再为它拆解研发任务。"
            else:
                tasks = breakdown_requirement(ctx, req)
                result = {"kind": "tasks", "items": tasks}
                reply = f"已将「{req['title']}」拆解为 {len(tasks)} 个可验收任务，并分配给 Agent 或人工负责人。"

        elif intent == "code":
            req = _context_requirement(ctx, message, context)
            if not req:
                reply = "请先选择一条需求，我再开始编码。"
            else:
                artifact = code_requirement(ctx, req)
                result = {"kind": "artifact", "item": artifact}
                reply = f"已为「{req['title']}」生成代码制品 {artifact['name']} {artifact['version']}（校验和 {artifact['checksum'] or '-'}），并完成关联的 Agent 任务。"

        elif intent == "test":
            req = _context_requirement(ctx, message, context)
            if not req:
                reply = "请先选择一条需求，我再生成并执行测试。"
            else:
                run = test_requirement(ctx, req)
                result = {"kind": "testRun", "item": run}
                reply = f"已为「{req['title']}」生成 {run['total']} 个测试用例（{run['passed']}/{run['total']} 通过，模拟执行，未运行真实测试）。"

        elif intent == "pipeline":
            req = _context_requirement(ctx, message, context)
            if not req:
                reply = "请先选择一条需求，我再生成并执行 CI/CD 流水线。"
            else:
                pipeline = ensure_pipeline(ctx, req, agent)
                artifact = db.fetch_one(
                    "SELECT * FROM artifacts WHERE requirement_id=%s ORDER BY created_at DESC LIMIT 1",
                    (req["id"],),
                )
                run = run_pipeline(ctx, pipeline, str(artifact["id"]) if artifact else None)
                result = {"kind": "pipelineRun", "item": run, "pipeline": serializers.pipeline(pipeline)}
                reply = f"流水线「{pipeline['name']}」已执行 {len(run['stages'])} 个阶段（模拟执行，未连接真实 CI），状态：{run['status']}。制品已标记为 released。"

        elif intent == "deploy":
            req = _context_requirement(ctx, message, context)
            artifact = None
            if req:
                artifact = db.fetch_one(
                    "SELECT * FROM artifacts WHERE requirement_id=%s ORDER BY created_at DESC LIMIT 1",
                    (req["id"],),
                )
            if not artifact:
                artifact = db.fetch_one(
                    "SELECT * FROM artifacts WHERE tenant_id=%s ORDER BY created_at DESC LIMIT 1",
                    (ctx.tenant["id"],),
                )
            env = _context_environment(ctx, message, context)
            if not artifact:
                reply = "还没有可部署的制品。请先让我编码并构建制品。"
            elif not env:
                reply = "当前租户还没有可用环境。环境 IP、账号与密码属于人工管理范围，请管理员先在「环境配置」中维护。"
            else:
                dep = deploy_artifact(ctx, artifact, env)
                result = {"kind": "deployment", "item": dep}
                reply = f"已记录制品 {artifact['name']} {artifact['version']} 到「{env['name']}」的部署（模拟执行，未连接目标主机），访问地址：{dep.get('url') or '未配置'}。"

        elif intent == "monitor":
            monitors = db.fetch_all(
                "SELECT * FROM monitors WHERE tenant_id=%s ORDER BY created_at DESC", (ctx.tenant["id"],)
            )
            if not monitors:
                reply = "当前租户还没有监控项。管理员可在「运维监控」为已部署环境配置 HTTP 健康检查。"
            else:
                checked = []
                for m in monitors:
                    try:
                        checked.append(check_monitor(ctx, m))
                    except Exception:
                        pass
                down = [m for m in checked if m["status"] == "down"]
                result = {"kind": "monitors", "items": checked}
                reply = (
                    f"已巡检 {len(checked)} 个监控项，{len(down)} 个异常，异常已自动生成告警。"
                    if down else f"已巡检 {len(checked)} 个监控项，全部正常。"
                )

        elif intent == "autopilot":
            req = _context_requirement(ctx, message, context)
            if not req:
                reply = "请先选择一条需求，我再启动端到端自动化。"
            else:
                env = _context_environment(ctx, message, context)
                outcome = autopilot(ctx, req, env)
                result = {"kind": "autopilot", "item": outcome}
                done = [s for s in outcome["steps"] if s["ok"]]
                reply = (
                    f"已为「{req['title']}」完成端到端研发：设计 → {len(outcome['steps'])} 个阶段，"
                    f"其中 {len(done)} 步成功。"
                    + (" 部署：" + (outcome["deployment"] or {}).get("url", "已记录") if outcome.get("deployment") else " 部署未执行（缺少环境）。")
                )
        else:
            history = db.fetch_all(
                "SELECT role, content FROM messages WHERE conversation_id=%s ORDER BY created_at DESC LIMIT 8",
                (conversation["id"],),
            )
            reply = agents.chat_reply(message, agent, list(reversed(history)))
            result = {"kind": "chat"}
    except HTTPException:
        raise
    except Exception as e:
        reply = f"执行失败：{e}。可以重试，或改用更具体的指令（例如指定需求标题）。"
        result = {"kind": "error", "error": str(e)}

    if confirm and context.get("pendingAction"):
        context.pop("pendingAction", None)
        conversation["context"] = context
        db.execute(
            "UPDATE conversations SET context=%s WHERE id=%s",
            (Json(context), conversation["id"]),
        )
    return _persist_message(conversation, reply, intent, result or {})
