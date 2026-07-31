"""Transones backend — FastAPI REST API + agent runtime.

Run:  .venv/bin/uvicorn main:app --app-dir server --port 8000 --reload
Schema is managed by Alembic (alembic upgrade head).
"""
from dotenv import load_dotenv

load_dotenv()  # must run before db/agents read env vars

from fastapi import Body, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from psycopg2.extras import Json

import db
import agents

app = FastAPI(title="transones", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- row mappers (snake_case pg → camelCase API) ---


def _s(v):
    return str(v) if v is not None else None


def _iso(v):
    return v.isoformat() if v is not None else None


def map_meeting(r):
    return {
        "id": _s(r["id"]), "projectId": _s(r["project_id"]), "title": r["title"],
        "rawNotes": r["raw_notes"], "transcript": r["transcript"],
        "participants": r["participants"], "source": r["source"],
        "createdAt": _iso(r["created_at"]),
    }


def map_requirement(r):
    return {
        "id": _s(r["id"]), "projectId": _s(r["project_id"]), "title": r["title"],
        "description": r["description"], "status": r["status"], "priority": r["priority"],
        "acceptanceCriteria": r["acceptance_criteria"], "sourceMeetingId": _s(r["source_meeting_id"]),
        "prototype": r["prototype"], "artifact": r["artifact"],
        "chatHistory": [], "comments": [], "assets": [],
        "createdAt": _iso(r["created_at"]),
    }


def map_task(r):
    return {
        "id": _s(r["id"]), "requirementId": _s(r["requirement_id"]), "title": r["title"],
        "description": r["description"], "assigneeKind": r["assignee_kind"],
        "assigneeId": r["assignee_id"], "status": r["status"], "estimate": r["estimate"],
        "acceptanceCriteria": r["acceptance_criteria"],
    }


def map_test_run(r):
    return {
        "id": _s(r["id"]), "requirementId": _s(r["requirement_id"]), "status": r["status"],
        "cases": r["cases"], "passed": r["passed"], "total": r["total"],
        "createdAt": _iso(r["created_at"]),
    }


def map_deployment(r):
    return {
        "id": _s(r["id"]), "artifactId": _s(r["artifact_id"]), "environment": r["environment"],
        "status": r["status"], "url": r["url"], "deployedAt": _iso(r["deployed_at"]),
    }


def map_activity(r):
    return {
        "id": _s(r["id"]), "projectId": _s(r["project_id"]), "actorKind": r["actor_kind"],
        "actorId": r["actor_id"], "type": r["type"], "payload": r["payload"], "at": _iso(r["at"]),
    }


def log_activity(actor_kind, actor_id, type_, payload=None, project_id=None):
    db.execute_returning(
        """INSERT INTO activity_events (project_id, actor_kind, actor_id, type, payload)
           VALUES (%s, %s, %s, %s, %s) RETURNING *""",
        (project_id, actor_kind, actor_id, type_, Json(payload or {})),
    )


# --- health & hydration ---


@app.get("/")
def root():
    return {"app": "transones", "ok": True}


@app.get("/api/health")
def health():
    return {"ok": True, "provider": agents.get_provider()}


@app.get("/api/state")
def get_state():
    return {
        "meetings": [map_meeting(r) for r in db.fetch_all("SELECT * FROM meetings ORDER BY created_at DESC")],
        "requirements": [map_requirement(r) for r in db.fetch_all("SELECT * FROM requirements ORDER BY created_at DESC")],
        "tasks": [map_task(r) for r in db.fetch_all("SELECT * FROM dev_tasks ORDER BY created_at DESC")],
        "testRuns": [map_test_run(r) for r in db.fetch_all("SELECT * FROM test_runs ORDER BY created_at DESC")],
        "deployments": [map_deployment(r) for r in db.fetch_all("SELECT * FROM deployments ORDER BY deployed_at DESC")],
        "activity": [map_activity(r) for r in db.fetch_all("SELECT * FROM activity_events ORDER BY at DESC LIMIT 100")],
    }


# --- entity writes ---


@app.post("/api/meetings")
def create_meeting(body: dict = Body(...)):
    row = db.execute_returning(
        """INSERT INTO meetings (title, raw_notes, participants, source)
           VALUES (%s, %s, %s, %s) RETURNING *""",
        (body["title"], body["rawNotes"], Json(body.get("participants") or []), body.get("source", "manual")),
    )
    log_activity("human", "current-user", "meeting.created", {"title": body["title"]})
    return map_meeting(row)


@app.post("/api/requirements")
def create_requirements(body: list = Body(...)):
    out = []
    for item in body:
        row = db.execute_returning(
            """INSERT INTO requirements (title, description, priority, acceptance_criteria, source_meeting_id)
               VALUES (%s, %s, %s, %s, NULLIF(%s,'')::uuid) RETURNING *""",
            (item["title"], item.get("description"), item.get("priority"),
             Json(item.get("acceptanceCriteria") or []), item.get("sourceMeetingId") or ""),
        )
        out.append(map_requirement(row))
    if out:
        log_activity("agent", "extractor", "requirement.created", {"count": len(out)})
    return out


@app.post("/api/tasks")
def create_tasks(body: list = Body(...)):
    out = []
    for item in body:
        row = db.execute_returning(
            """INSERT INTO dev_tasks (requirement_id, title, description, assignee_kind, assignee_id, estimate, acceptance_criteria)
               VALUES ((%s)::uuid, %s, %s, %s, %s, %s, %s) RETURNING *""",
            (item["requirementId"], item["title"], item.get("description"),
             item.get("assigneeKind", "agent"), item.get("assigneeId"),
             item.get("estimate"), Json(item.get("acceptanceCriteria") or [])),
        )
        out.append(map_task(row))
    if out:
        log_activity("agent", "breakdown", "task.created", {"count": len(out)})
    return out


@app.patch("/api/tasks/{task_id}/status")
def update_task_status(task_id: str, body: dict = Body(...)):
    row = db.execute_returning(
        "UPDATE dev_tasks SET status=%s WHERE id=(%s)::uuid RETURNING *",
        (body["status"], task_id),
    )
    if not row:
        raise HTTPException(404, "task not found")
    log_activity("human", "current-user", "task.status_changed", {"taskId": task_id, "status": body["status"]})
    return map_task(row)


@app.post("/api/test-runs")
def create_test_run(body: dict = Body(...)):
    row = db.execute_returning(
        """INSERT INTO test_runs (requirement_id, status, cases, passed, total)
           VALUES ((%s)::uuid, %s, %s, %s, %s) RETURNING *""",
        (body["requirementId"], body["status"], Json(body["cases"]), body["passed"], body["total"]),
    )
    log_activity("agent", "tester", "test.run", {"passed": body["passed"], "total": body["total"]})
    return map_test_run(row)


@app.post("/api/deployments")
def create_deployment(body: dict = Body(...)):
    row = db.execute_returning(
        """INSERT INTO deployments (artifact_id, environment, status, url)
           VALUES ((%s)::uuid, %s, %s, %s) RETURNING *""",
        (body["artifactId"], body["environment"], body.get("status", "success"), body.get("url")),
    )
    log_activity("agent", "deployer", "deployment.created",
                 {"environment": body["environment"], "status": body.get("status", "success")})
    return map_deployment(row)


# --- agent runs (drive claude / opencode) ---


@app.post("/api/agents/extract")
def agent_extract(body: dict = Body(...)):
    try:
        return {"requirements": agents.extract_requirements(body["title"], body["notes"])}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post("/api/agents/breakdown")
def agent_breakdown(body: dict = Body(...)):
    try:
        return {"tasks": agents.breakdown_requirement(
            body["title"], body.get("description", ""), body.get("acceptanceCriteria", []))}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post("/api/agents/test")
def agent_test(body: dict = Body(...)):
    try:
        return {"cases": agents.generate_test_cases(
            body["title"], body.get("description", ""), body.get("acceptanceCriteria", []))}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post("/api/agents/deploy")
def agent_deploy(body: dict = Body(...)):
    try:
        return {"plan": agents.generate_deployment_plan(body["title"], body.get("description", ""))}
    except Exception as e:
        raise HTTPException(500, str(e))
