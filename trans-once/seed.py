"""Idempotent bootstrap: super admin + a fully-populated demo tenant.

The demo tenant exists so a fresh install immediately shows the whole
meeting → requirement → design → code → CI/CD → deploy → monitor chain.
Real tenants start clean and configure their own environments.
"""
import json
import logging

from psycopg2.extras import Json

import db
import mock_agent
import orchestration
from config import ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD, DEFAULT_ROLE
from deps import TenantContext
from security import encrypt_secret, hash_password

log = logging.getLogger("transonce.seed")


def _user(email: str, name: str, password: str, super_admin: bool = False) -> dict:
    existing = db.fetch_one("SELECT * FROM users WHERE lower(email)=lower(%s)", (email,))
    if existing:
        if super_admin and not existing.get("is_super_admin"):
            db.execute("UPDATE users SET is_super_admin=TRUE WHERE id=%s", (existing["id"],))
            existing["is_super_admin"] = True
        return existing
    return db.execute_returning(
        """INSERT INTO users (email, name, password_hash, is_super_admin)
           VALUES (%s, %s, %s, %s) RETURNING *""",
        (email, name, hash_password(password), super_admin),
    )


def _role(tenant_id: str, name: str) -> dict:
    return db.fetch_one("SELECT * FROM roles WHERE tenant_id=%s AND name=%s", (tenant_id, name))


def _member(tenant_id: str, user: dict, role: dict, admin: bool = False) -> dict:
    row = db.fetch_one(
        "SELECT * FROM tenant_members WHERE tenant_id=%s AND user_id=%s", (tenant_id, user["id"])
    )
    if row:
        return row
    return db.execute_returning(
        """INSERT INTO tenant_members (tenant_id, user_id, role_id, status, is_tenant_admin, joined_at)
           VALUES (%s, %s, %s, 'active', %s, now()) RETURNING *""",
        (tenant_id, user["id"], role["id"], admin),
    )


def _agent_for(tenant: dict, user: dict, role: dict, provider: str = "auto") -> dict:
    existing = db.fetch_one(
        "SELECT * FROM agents WHERE tenant_id=%s AND owner_user_id=%s", (tenant["id"], user["id"])
    )
    if existing:
        return existing
    ctx = TenantContext(
        tenant=tenant, user=user, role=role,
        is_tenant_admin=bool(user.get("is_super_admin")),
        is_super_admin=bool(user.get("is_super_admin")),
        permissions=list(role.get("permissions") or []),
    )
    agent = orchestration.ensure_personal_agent(ctx)
    if provider != "auto":
        db.execute("UPDATE agents SET provider=%s WHERE id=%s", (provider, agent["id"]))
        agent["provider"] = provider
    return agent


SAMPLE_NOTES = """时间：2026-10-20 上午 10:00
参会人：产品负责人林小满、研发陈一鸣、测试赵敏、DevOps 周航

1. 林小满：本期目标是让会议纪要可以直接驱动需求提取，减少手工整理。
2. 陈一鸣：需求要能关联来源会议，支持验收标准和优先级，并且保留 Agent 运行记录。
3. 赵敏：每条需求必须有可验证的验收标准，空纪要和纯闲聊要有兜底提示。
4. 周航：需求完成后要能一键生成制品、跑流水线、部署到测试环境，并自动纳入健康监控。
5. 决议：先打通会议→需求→设计→研发→测试→部署→监控的闭环，生产发布保留人工审批。
"""


def seed() -> None:
    admin = _user(ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD, super_admin=True)
    if not db.fetch_one("SELECT id FROM tenants WHERE slug='innovatech'"):
        log.info("seeding demo tenant")
        tenant = db.execute_returning(
            """INSERT INTO tenants (name, slug, description, join_policy, created_by)
               VALUES (%s, %s, %s, 'approval', %s) RETURNING *""",
            ("创新数智研发组", "innovatech", "一站式 Agent 研发链路演示空间，覆盖会议到运维的全流程。", admin["id"]),
        )
        from routers.tenants import _create_roles
        roles = _create_roles(str(tenant["id"]))
        product = _user("product@transonce.local", "林小满", "demo123")
        dev = _user("dev@transonce.local", "陈一鸣", "demo123")
        _member(str(tenant["id"]), admin, roles["租户管理员"], True)
        _member(str(tenant["id"]), product, roles["产品负责人"])
        _member(str(tenant["id"]), dev, roles["研发工程师"])
        _agent_for(tenant, admin, roles["租户管理员"])
        _agent_for(tenant, product, roles["产品负责人"])
        _agent_for(tenant, dev, roles["研发工程师"])

        project = db.execute_returning(
            """INSERT INTO projects (tenant_id, name, description, created_by)
               VALUES (%s, %s, %s, %s) RETURNING *""",
            (tenant["id"], "全渠道零售电商平台", "B2B/B2C 全渠道零售解决方案，包含主站与管理中台。", admin["id"]),
        )
        web = db.execute_returning(
            "INSERT INTO systems (project_id, name, description) VALUES (%s,%s,%s) RETURNING *",
            (project["id"], "Web 前端", "React 19 + Vite + Tailwind 管理端"),
        )
        api = db.execute_returning(
            "INSERT INTO systems (project_id, name, description) VALUES (%s,%s,%s) RETURNING *",
            (project["id"], "API 服务", "FastAPI + PostgreSQL 业务服务"),
        )
        db.execute(
            "INSERT INTO codebases (system_id, name, repo_url, language) VALUES (%s,%s,%s,%s)",
            (web["id"], "retail-web", "git@github.com:demo/retail-web.git", "TypeScript"),
        )
        db.execute(
            "INSERT INTO codebases (system_id, name, repo_url, language) VALUES (%s,%s,%s,%s)",
            (api["id"], "retail-api", "git@github.com:demo/retail-api.git", "Python"),
        )

        test_env = db.execute_returning(
            """INSERT INTO environments
               (tenant_id, name, kind, base_url, ip, username, password_enc, config, managed_by)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *""",
            (
                tenant["id"], "测试环境", "test", "http://localhost:9005/api/health", "127.0.0.1",
                "deploy", encrypt_secret("demo-pass-123"),
                Json({"replicas": 1, "note": "演示用途"}), admin["id"],
            ),
        )
        db.execute(
            """INSERT INTO environments
               (tenant_id, name, kind, base_url, ip, username, password_enc, config, managed_by)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            (
                tenant["id"], "生产环境", "production", "https://demo.transonce.local", "10.0.0.10",
                "deploy", encrypt_secret("prod-pass-456"),
                Json({"replicas": 3, "note": "生产发布需 deploy.production 权限"}), admin["id"],
            ),
        )

        meeting = db.execute_returning(
            """INSERT INTO meetings (tenant_id, project_id, title, raw_notes, participants, source, created_by)
               VALUES (%s,%s,%s,%s,%s,'manual',%s) RETURNING *""",
            (
                tenant["id"], project["id"], "会议纪要驱动研发闭环评审", SAMPLE_NOTES,
                Json([{"name": "林小满", "role": "产品"}, {"name": "陈一鸣", "role": "研发"},
                      {"name": "赵敏", "role": "测试"}, {"name": "周航", "role": "DevOps"}]),
                admin["id"],
            ),
        )

        drafts = mock_agent.extract_requirements(meeting["title"], SAMPLE_NOTES)
        created = []
        for d in drafts:
            row = db.execute_returning(
                """INSERT INTO requirements
                   (tenant_id, project_id, title, description, priority, acceptance_criteria,
                    source_meeting_id, created_by)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *""",
                (
                    tenant["id"], project["id"], d["title"], d["description"], d["priority"],
                    Json(d["acceptanceCriteria"]), meeting["id"], admin["id"],
                ),
            )
            created.append(row)
        db.execute("UPDATE meetings SET status='extracted' WHERE id=%s", (meeting["id"],))

        ctx = TenantContext(
            tenant=tenant, user=admin, role=roles["租户管理员"],
            is_tenant_admin=True, is_super_admin=True,
            permissions=list(roles["租户管理员"]["permissions"]),
        )
        first = created[0]
        designed = mock_agent.design_requirement(
            first["title"], first.get("description") or "", first.get("acceptance_criteria") or []
        )
        db.execute(
            "UPDATE requirements SET prototype=%s, architecture=%s, design_status='designed', status='designing' WHERE id=%s",
            (json.dumps(designed["prototype"], ensure_ascii=False), Json(designed["architecture"]), first["id"]),
        )
        tasks = mock_agent.breakdown_requirement(
            first["title"], first.get("description") or "", first.get("acceptance_criteria") or []
        )
        for t in tasks:
            db.execute(
                """INSERT INTO dev_tasks
                   (tenant_id, requirement_id, title, description, assignee_kind, assignee_id,
                    status, estimate, acceptance_criteria)
                   VALUES (%s,%s,%s,%s,%s,%s,'queued',%s,%s)""",
                (
                    tenant["id"], first["id"], t["title"], t["description"],
                    "agent" if t["suggestedAssignee"] == "agent" else "human",
                    None, t["estimate"], Json(t["acceptanceCriteria"]),
                ),
            )
        code = mock_agent.generate_code(first["title"], first.get("description") or "", tasks)
        artifact = db.execute_returning(
            """INSERT INTO artifacts
               (tenant_id, requirement_id, name, type, version, content, checksum, status, created_by)
               VALUES (%s,%s,%s,'code',%s,%s,%s,'released',%s) RETURNING *""",
            (
                tenant["id"], first["id"], code["artifactName"], code["version"],
                json.dumps(code["files"], ensure_ascii=False), code["checksum"], admin["id"],
            ),
        )
        db.execute("UPDATE requirements SET artifact=%s WHERE id=%s", (str(artifact["id"]), first["id"]))
        cases = mock_agent.generate_test_cases(
            first["title"], first.get("description") or "", first.get("acceptance_criteria") or []
        )
        db.execute(
            """INSERT INTO test_runs (tenant_id, requirement_id, status, cases, passed, total)
               VALUES (%s,%s,'passed',%s,%s,%s)""",
            (
                tenant["id"], first["id"],
                Json([{"id": f"tc_{i}", "title": c["title"], "type": c["type"], "passed": True} for i, c in enumerate(cases, 1)]),
                len(cases), len(cases),
            ),
        )

        pipeline = db.execute_returning(
            """INSERT INTO pipelines (tenant_id, project_id, name, description, stages, trigger, created_by)
               VALUES (%s,%s,%s,%s,%s,'manual',%s) RETURNING *""",
            (
                tenant["id"], project["id"], "主应用交付流水线", "依赖安装 → 检查 → 构建 → 测试 → 制品 → 部署",
                Json(mock_agent.generate_deployment_plan("主应用", "演示")["stages"]), admin["id"],
            ),
        )
        run = db.execute_returning(
            """INSERT INTO pipeline_runs
               (pipeline_id, tenant_id, artifact_id, status, stages, log, triggered_by, ended_at)
               VALUES (%s,%s,%s,'succeeded',%s,%s,%s, now()) RETURNING *""",
            (
                pipeline["id"], tenant["id"], artifact["id"],
                Json([{**s, "status": "success", "durationMs": 120} for s in pipeline["stages"]]),
                "seeded demo pipeline run", admin["id"],
            ),
        )
        db.execute("UPDATE artifacts SET pipeline_run_id=%s WHERE id=%s", (run["id"], artifact["id"]))
        deployment = db.execute_returning(
            """INSERT INTO deployments
               (tenant_id, artifact_id, environment_id, environment, status, url, notes, deployed_by)
               VALUES (%s,%s,%s,%s,'success',%s,%s,%s) RETURNING *""",
            (
                tenant["id"], artifact["id"], test_env["id"], test_env["name"],
                test_env["base_url"], "演示部署：测试环境", admin["id"],
            ),
        )
        db.execute(
            """INSERT INTO monitors
               (tenant_id, environment_id, name, url, method, expected_status, interval_seconds, status, created_by)
               VALUES (%s,%s,%s,%s,'GET',200,300,'unknown',%s)""",
            (tenant["id"], test_env["id"], "测试环境健康检查", test_env["base_url"], admin["id"]),
        )

        events = [
            ("tenant.created", {"tenant": tenant["name"]}, "human", admin["name"]),
            ("meeting.created", {"title": meeting["title"]}, "human", admin["name"]),
            ("meeting.extracted", {"count": len(created)}, "agent", "需求架构师"),
            ("design.generated", {"title": first["title"]}, "agent", "设计 Agent"),
            ("task.created", {"count": len(tasks)}, "agent", "拆解 Agent"),
            ("artifact.built", {"name": code["artifactName"], "version": code["version"]}, "agent", "编码 Agent"),
            ("test.run", {"passed": len(cases), "total": len(cases)}, "agent", "测试 Agent"),
            ("pipeline.run", {"status": "succeeded"}, "agent", "部署 Agent"),
            ("deployment.created", {"environment": test_env["name"], "status": "success"}, "agent", "部署 Agent"),
        ]
        for type_, payload, kind, actor in events:
            db.execute(
                """INSERT INTO activity_events
                   (tenant_id, project_id, actor_kind, actor_id, actor_user_id, type, payload)
                   VALUES (%s,%s,%s,%s,%s,%s,%s)""",
                (tenant["id"], project["id"], kind, actor, admin["id"], type_, Json(payload)),
            )
        log.info("demo tenant seeded")
    else:
        log.info("demo tenant already present")
