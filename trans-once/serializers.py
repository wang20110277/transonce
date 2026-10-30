"""Row → API (camelCase) serializers shared by all routers."""
from config import EXECUTION_MODE
from security import decrypt_secret, mask_secret

SIMULATED = EXECUTION_MODE != "real"


def _s(v):
    return str(v) if v is not None else None


def _iso(v):
    return v.isoformat() if v is not None else None


def user(r: dict) -> dict:
    if not r:
        return {}
    return {
        "id": _s(r["id"]),
        "email": r["email"],
        "name": r["name"],
        "avatar": r.get("avatar"),
        "isSuperAdmin": bool(r.get("is_super_admin")),
        "status": r.get("status"),
        "authProvider": r.get("auth_provider") or "password",
        "createdAt": _iso(r.get("created_at")),
    }


def tenant(r: dict) -> dict:
    return {
        "id": _s(r["id"]),
        "name": r["name"],
        "slug": r["slug"],
        "description": r.get("description"),
        "logo": r.get("logo"),
        "joinPolicy": r.get("join_policy"),
        "status": r.get("status"),
        "createdAt": _iso(r.get("created_at")),
    }


def role(r: dict) -> dict:
    return {
        "id": _s(r["id"]),
        "tenantId": _s(r.get("tenant_id")),
        "name": r["name"],
        "description": r.get("description"),
        "permissions": r.get("permissions") or [],
        "isSystem": bool(r.get("is_system")),
        "createdAt": _iso(r.get("created_at")),
    }


def member(r: dict, include_email: bool = True) -> dict:
    return {
        "id": _s(r["id"]),
        "userId": _s(r["user_id"]),
        "name": r.get("name"),
        "email": r.get("email") if include_email else None,
        "avatar": r.get("avatar"),
        "roleId": _s(r.get("role_id")),
        "roleName": r.get("role_name"),
        "status": r.get("status"),
        "isTenantAdmin": bool(r.get("is_tenant_admin")),
        "isSuperAdmin": bool(r.get("is_super_admin")),
        "joinedAt": _iso(r.get("joined_at")),
        "agentId": _s(r.get("agent_id")),
    }


def join_request(r: dict) -> dict:
    return {
        "id": _s(r["id"]),
        "tenantId": _s(r["tenant_id"]),
        "userId": _s(r["user_id"]),
        "name": r.get("name"),
        "email": r.get("email"),
        "message": r.get("message"),
        "status": r["status"],
        "roleId": _s(r.get("role_id")),
        "createdAt": _iso(r.get("created_at")),
        "reviewedAt": _iso(r.get("reviewed_at")),
    }


def agent(r: dict, include_prompt: bool = True) -> dict:
    out = {
        "id": _s(r["id"]),
        "tenantId": _s(r["tenant_id"]),
        "ownerUserId": _s(r.get("owner_user_id")),
        "ownerName": r.get("owner_name"),
        "name": r["name"],
        "provider": r["provider"],
        "model": r.get("model"),
        "description": r.get("description"),
        "tools": r.get("tools") or [],
        "isDefault": bool(r.get("is_default")),
        "status": r.get("status"),
        "createdAt": _iso(r.get("created_at")),
    }
    if include_prompt:
        out["systemPrompt"] = r.get("system_prompt")
    return out


def conversation(r: dict) -> dict:
    return {
        "id": _s(r["id"]),
        "tenantId": _s(r["tenant_id"]),
        "userId": _s(r["user_id"]),
        "agentId": _s(r["agent_id"]),
        "title": r["title"],
        "createdAt": _iso(r.get("created_at")),
        "updatedAt": _iso(r.get("updated_at")),
    }


def message(r: dict) -> dict:
    return {
        "id": _s(r["id"]),
        "conversationId": _s(r["conversation_id"]),
        "role": r["role"],
        "content": r["content"],
        "intent": r.get("intent"),
        "actionResult": r.get("action_result"),
        "createdAt": _iso(r.get("created_at")),
    }


def project(r: dict) -> dict:
    return {
        "id": _s(r["id"]),
        "tenantId": _s(r["tenant_id"]),
        "name": r["name"],
        "description": r.get("description"),
        "status": r.get("status"),
        "systemCount": r.get("system_count"),
        "createdAt": _iso(r.get("created_at")),
    }


def system(r: dict) -> dict:
    return {
        "id": _s(r["id"]),
        "projectId": _s(r["project_id"]),
        "name": r["name"],
        "description": r.get("description"),
        "status": r.get("status"),
        "createdAt": _iso(r.get("created_at")),
    }


def codebase(r: dict) -> dict:
    return {
        "id": _s(r["id"]),
        "systemId": _s(r["system_id"]),
        "name": r["name"],
        "repoUrl": r.get("repo_url"),
        "language": r.get("language"),
        "defaultBranch": r.get("default_branch"),
        "repoId": _s(r.get("repo_id")),
        "repoPath": r.get("repo_path"),
        "createdAt": _iso(r.get("created_at")),
    }


def environment(r: dict, reveal: bool = False) -> dict:
    return {
        "id": _s(r["id"]),
        "tenantId": _s(r["tenant_id"]),
        "name": r["name"],
        "kind": r["kind"],
        "baseUrl": r.get("base_url"),
        "ip": r.get("ip"),
        "username": r.get("username"),
        "passwordMasked": mask_secret(decrypt_secret(r.get("password_enc"))),
        "hasPassword": bool(r.get("password_enc")),
        "password": None if not reveal else "__SERVER_SIDE_ONLY__",
        "config": r.get("config") or {},
        "createdAt": _iso(r.get("created_at")),
    }


def gitlab_connection(r: dict) -> dict:
    return {
        "id": _s(r["id"]),
        "tenantId": _s(r.get("tenant_id")),
        "name": r["name"],
        "baseUrl": r.get("base_url"),
        "mode": r.get("mode"),
        "status": r.get("status"),
        "account": r.get("account"),
        "insecureTls": bool(r.get("insecure_tls")),
        "hasToken": bool(r.get("token_enc")),
        "tokenMasked": mask_secret(decrypt_secret(r.get("token_enc"))),
        "lastSyncAt": _iso(r.get("last_sync_at")),
        "lastError": r.get("last_error"),
        "repoCount": r.get("repo_count"),
        "createdAt": _iso(r.get("created_at")),
    }


def git_repo(r: dict) -> dict:
    return {
        "id": _s(r["id"]),
        "tenantId": _s(r.get("tenant_id")),
        "connectionId": _s(r.get("connection_id")),
        "connectionName": r.get("connection_name"),
        "externalId": r.get("external_id"),
        "path": r["path"],
        "name": r["name"],
        "namespace": r.get("namespace"),
        "webUrl": r.get("web_url"),
        "description": r.get("description"),
        "defaultBranch": r.get("default_branch"),
        "visibility": r.get("visibility"),
        "archived": bool(r.get("archived")),
        "lastActivityAt": _iso(r.get("last_activity_at")),
        "fetchedAt": _iso(r.get("fetched_at")),
    }


def repo_access_grant(r: dict) -> dict:
    return {
        "id": _s(r["id"]),
        "tenantId": _s(r.get("tenant_id")),
        "repoId": _s(r.get("repo_id")),
        "repoPath": r.get("repo_path"),
        "userId": _s(r.get("user_id")),
        "userName": r.get("user_name"),
        "userEmail": r.get("user_email"),
        "role": r["role"],
        "grantedAt": _iso(r.get("granted_at")),
    }


def repo_access_request(r: dict) -> dict:
    return {
        "id": _s(r["id"]),
        "tenantId": _s(r.get("tenant_id")),
        "repoId": _s(r.get("repo_id")),
        "repoPath": r.get("repo_path"),
        "repoName": r.get("repo_name"),
        "userId": _s(r.get("user_id")),
        "userName": r.get("user_name"),
        "userEmail": r.get("user_email"),
        "role": r["role"],
        "reason": r.get("reason"),
        "status": r["status"],
        "reviewNote": r.get("review_note"),
        "reviewedAt": _iso(r.get("reviewed_at")),
        "createdAt": _iso(r.get("created_at")),
    }


def meeting(r: dict) -> dict:
    return {
        "id": _s(r["id"]),
        "tenantId": _s(r.get("tenant_id")),
        "projectId": _s(r.get("project_id")),
        "title": r["title"],
        "rawNotes": r.get("raw_notes"),
        "transcript": r.get("transcript"),
        "participants": r.get("participants") or [],
        "source": r.get("source"),
        "status": r.get("status"),
        "createdAt": _iso(r.get("created_at")),
    }


def requirement(r: dict) -> dict:
    return {
        "id": _s(r["id"]),
        "tenantId": _s(r.get("tenant_id")),
        "projectId": _s(r.get("project_id")),
        "title": r["title"],
        "description": r.get("description"),
        "status": r.get("status"),
        "priority": r.get("priority"),
        "acceptanceCriteria": r.get("acceptance_criteria") or [],
        "sourceMeetingId": _s(r.get("source_meeting_id")),
        "prototype": r.get("prototype"),
        "architecture": r.get("architecture") or {},
        "designStatus": r.get("design_status"),
        "artifact": r.get("artifact"),
        "createdAt": _iso(r.get("created_at")),
    }


def task(r: dict) -> dict:
    return {
        "id": _s(r["id"]),
        "tenantId": _s(r.get("tenant_id")),
        "requirementId": _s(r["requirement_id"]),
        "title": r["title"],
        "description": r.get("description"),
        "assigneeKind": r.get("assignee_kind"),
        "assigneeId": _s(r.get("assignee_id")),
        "status": r.get("status"),
        "estimate": r.get("estimate"),
        "acceptanceCriteria": r.get("acceptance_criteria") or [],
        "agentRunId": _s(r.get("agent_run_id")),
        "createdAt": _iso(r.get("created_at")),
    }


def agent_run(r: dict) -> dict:
    return {
        "id": _s(r["id"]),
        "tenantId": _s(r.get("tenant_id")),
        "agentId": _s(r.get("agent_id")),
        "agentName": r.get("agent_name"),
        "taskType": r.get("task_type"),
        "status": r.get("status"),
        "input": r.get("input"),
        "output": r.get("output"),
        "events": r.get("events") or [],
        "error": r.get("error"),
        "startedAt": _iso(r.get("started_at")),
        "endedAt": _iso(r.get("ended_at")),
    }


def test_run(r: dict) -> dict:
    return {
        "id": _s(r["id"]),
        "requirementId": _s(r.get("requirement_id")),
        "status": r.get("status"),
        "cases": r.get("cases") or [],
        "passed": r.get("passed") or 0,
        "total": r.get("total") or 0,
        "agentRunId": _s(r.get("agent_run_id")),
        "simulated": SIMULATED,
        "createdAt": _iso(r.get("created_at")),
    }


def artifact(r: dict) -> dict:
    return {
        "id": _s(r["id"]),
        "tenantId": _s(r.get("tenant_id")),
        "requirementId": _s(r.get("requirement_id")),
        "codebaseId": _s(r.get("codebase_id")),
        "pipelineRunId": _s(r.get("pipeline_run_id")),
        "name": r["name"],
        "type": r.get("type"),
        "version": r.get("version"),
        "content": r.get("content"),
        "checksum": r.get("checksum"),
        "status": r.get("status"),
        "repoUrl": r.get("repo_url"),
        "createdAt": _iso(r.get("created_at")),
    }


def pipeline(r: dict) -> dict:
    return {
        "id": _s(r["id"]),
        "tenantId": _s(r.get("tenant_id")),
        "projectId": _s(r.get("project_id")),
        "name": r["name"],
        "description": r.get("description"),
        "stages": r.get("stages") or [],
        "trigger": r.get("trigger"),
        "createdAt": _iso(r.get("created_at")),
    }


def pipeline_run(r: dict) -> dict:
    return {
        "id": _s(r["id"]),
        "pipelineId": _s(r.get("pipeline_id")),
        "tenantId": _s(r.get("tenant_id")),
        "artifactId": _s(r.get("artifact_id")),
        "status": r.get("status"),
        "stages": r.get("stages") or [],
        "log": r.get("log"),
        "simulated": SIMULATED,
        "startedAt": _iso(r.get("started_at")),
        "endedAt": _iso(r.get("ended_at")),
    }


def deployment(r: dict) -> dict:
    return {
        "id": _s(r["id"]),
        "tenantId": _s(r.get("tenant_id")),
        "artifactId": _s(r.get("artifact_id")),
        "artifactName": r.get("artifact_name"),
        "environmentId": _s(r.get("environment_id")),
        "environment": r.get("environment"),
        "status": r.get("status"),
        "url": r.get("url"),
        "notes": r.get("notes"),
        "simulated": SIMULATED,
        "deployedAt": _iso(r.get("deployed_at")),
        "createdAt": _iso(r.get("created_at")),
    }


def monitor(r: dict) -> dict:
    return {
        "id": _s(r["id"]),
        "tenantId": _s(r.get("tenant_id")),
        "environmentId": _s(r.get("environment_id")),
        "environmentName": r.get("environment_name"),
        "name": r["name"],
        "url": r["url"],
        "method": r.get("method"),
        "expectedStatus": r.get("expected_status"),
        "intervalSeconds": r.get("interval_seconds"),
        "status": r.get("status"),
        "lastCheckedAt": _iso(r.get("last_checked_at")),
        "lastLatencyMs": r.get("last_latency_ms"),
        "lastError": r.get("last_error"),
        "createdAt": _iso(r.get("created_at")),
    }


def alert(r: dict) -> dict:
    return {
        "id": _s(r["id"]),
        "tenantId": _s(r.get("tenant_id")),
        "monitorId": _s(r.get("monitor_id")),
        "monitorName": r.get("monitor_name"),
        "deploymentId": _s(r.get("deployment_id")),
        "severity": r.get("severity"),
        "title": r["title"],
        "detail": r.get("detail"),
        "status": r.get("status"),
        "createdAt": _iso(r.get("created_at")),
        "acknowledgedAt": _iso(r.get("acknowledged_at")),
        "resolvedAt": _iso(r.get("resolved_at")),
    }


def activity(r: dict) -> dict:
    return {
        "id": _s(r["id"]),
        "tenantId": _s(r.get("tenant_id")),
        "projectId": _s(r.get("project_id")),
        "actorKind": r.get("actor_kind"),
        "actorId": r.get("actor_id"),
        "type": r["type"],
        "payload": r.get("payload") or {},
        "at": _iso(r.get("at")),
    }
