"""platform: multi-tenancy, RBAC, agents, chat and full delivery-chain schema

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-21
"""
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

NEW_TABLES = [
    """
    CREATE TABLE users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT NOT NULL,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        avatar TEXT,
        is_super_admin BOOLEAN NOT NULL DEFAULT FALSE,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    "CREATE UNIQUE INDEX users_email_key ON users (lower(email))",
    """
    CREATE TABLE tenants (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        description TEXT,
        logo TEXT,
        join_policy TEXT NOT NULL DEFAULT 'approval',
        status TEXT NOT NULL DEFAULT 'active',
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    """
    CREATE TABLE roles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT,
        permissions JSONB NOT NULL DEFAULT '[]',
        is_system BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (tenant_id, name)
    )
    """,
    """
    CREATE TABLE tenant_members (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role_id UUID REFERENCES roles(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'invited',
        is_tenant_admin BOOLEAN NOT NULL DEFAULT FALSE,
        joined_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (tenant_id, user_id)
    )
    """,
    """
    CREATE TABLE tenant_join_requests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role_id UUID REFERENCES roles(id) ON DELETE SET NULL,
        message TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
        reviewed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    "CREATE UNIQUE INDEX join_requests_pending_key ON tenant_join_requests (tenant_id, user_id) WHERE status = 'pending'",
    """
    CREATE TABLE agents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        owner_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT 'auto',
        model TEXT,
        description TEXT,
        system_prompt TEXT,
        tools JSONB NOT NULL DEFAULT '[]',
        is_default BOOLEAN NOT NULL DEFAULT TRUE,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    "CREATE UNIQUE INDEX agents_owner_key ON agents (tenant_id, owner_user_id) WHERE owner_user_id IS NOT NULL",
    """
    CREATE TABLE conversations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        title TEXT NOT NULL DEFAULT '新的对话',
        context JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    """
    CREATE TABLE messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        intent TEXT,
        action_result JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    """
    CREATE TABLE projects (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    """
    CREATE TABLE systems (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    """
    CREATE TABLE codebases (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        system_id UUID NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        repo_url TEXT,
        language TEXT,
        default_branch TEXT NOT NULL DEFAULT 'main',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    """
    CREATE TABLE environments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'test',
        base_url TEXT,
        ip TEXT,
        username TEXT,
        password_enc TEXT,
        config JSONB NOT NULL DEFAULT '{}',
        managed_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (tenant_id, name)
    )
    """,
    """
    CREATE TABLE agent_runs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
        task_type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        input TEXT,
        output TEXT,
        events JSONB NOT NULL DEFAULT '[]',
        error TEXT,
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        ended_at TIMESTAMPTZ
    )
    """,
    """
    CREATE TABLE artifacts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        requirement_id UUID REFERENCES requirements(id) ON DELETE SET NULL,
        codebase_id UUID REFERENCES codebases(id) ON DELETE SET NULL,
        pipeline_run_id UUID,
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'code',
        version TEXT NOT NULL DEFAULT 'v0.1.0',
        content TEXT,
        checksum TEXT,
        status TEXT NOT NULL DEFAULT 'built',
        repo_url TEXT,
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    """
    CREATE TABLE pipelines (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        description TEXT,
        stages JSONB NOT NULL DEFAULT '[]',
        trigger TEXT NOT NULL DEFAULT 'manual',
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    """
    CREATE TABLE pipeline_runs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        pipeline_id UUID NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        artifact_id UUID REFERENCES artifacts(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'running',
        stages JSONB NOT NULL DEFAULT '[]',
        log TEXT,
        triggered_by UUID REFERENCES users(id) ON DELETE SET NULL,
        started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        ended_at TIMESTAMPTZ
    )
    """,
    """
    CREATE TABLE monitors (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        environment_id UUID REFERENCES environments(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        method TEXT NOT NULL DEFAULT 'GET',
        expected_status INT NOT NULL DEFAULT 200,
        interval_seconds INT NOT NULL DEFAULT 300,
        status TEXT NOT NULL DEFAULT 'unknown',
        last_checked_at TIMESTAMPTZ,
        last_latency_ms INT,
        last_error TEXT,
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    """
    CREATE TABLE alerts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        monitor_id UUID REFERENCES monitors(id) ON DELETE SET NULL,
        deployment_id UUID REFERENCES deployments(id) ON DELETE SET NULL,
        severity TEXT NOT NULL DEFAULT 'warning',
        title TEXT NOT NULL,
        detail TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        acknowledged_by UUID REFERENCES users(id) ON DELETE SET NULL,
        acknowledged_at TIMESTAMPTZ,
        resolved_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
]

# Extend the phase-1 tables with tenancy + delivery-chain columns.
ALTERS = [
    "ALTER TABLE meetings ADD COLUMN tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE",
    "ALTER TABLE meetings ADD COLUMN status TEXT NOT NULL DEFAULT 'draft'",
    "ALTER TABLE meetings ADD COLUMN created_by UUID REFERENCES users(id) ON DELETE SET NULL",
    "ALTER TABLE requirements ADD COLUMN tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE",
    "ALTER TABLE requirements ADD COLUMN architecture JSONB NOT NULL DEFAULT '{}'",
    "ALTER TABLE requirements ADD COLUMN design_status TEXT NOT NULL DEFAULT 'draft'",
    "ALTER TABLE requirements ADD COLUMN created_by UUID REFERENCES users(id) ON DELETE SET NULL",
    "ALTER TABLE dev_tasks ADD COLUMN tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE",
    "ALTER TABLE dev_tasks ADD COLUMN agent_run_id UUID",
    "ALTER TABLE test_runs ADD COLUMN tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE",
    "ALTER TABLE test_runs ADD COLUMN agent_run_id UUID",
    "ALTER TABLE deployments ADD COLUMN tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE",
    "ALTER TABLE deployments ADD COLUMN environment_id UUID REFERENCES environments(id) ON DELETE SET NULL",
    "ALTER TABLE deployments ADD COLUMN deployed_by UUID REFERENCES users(id) ON DELETE SET NULL",
    "ALTER TABLE deployments ADD COLUMN notes TEXT",
    "ALTER TABLE deployments ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now()",
    "ALTER TABLE activity_events ADD COLUMN tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE",
    "ALTER TABLE activity_events ADD COLUMN actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL",
    "CREATE INDEX idx_requirements_tenant ON requirements (tenant_id)",
    "CREATE INDEX idx_tasks_tenant ON dev_tasks (tenant_id)",
    "CREATE INDEX idx_meetings_tenant ON meetings (tenant_id)",
    "CREATE INDEX idx_activity_tenant ON activity_events (tenant_id, at DESC)",
    "CREATE INDEX idx_messages_conversation ON messages (conversation_id, created_at)",
    "CREATE INDEX idx_alerts_tenant ON alerts (tenant_id, status, created_at DESC)",
]

DROP_ORDER = [
    "alerts", "monitors", "pipeline_runs", "pipelines", "artifacts", "agent_runs",
    "codebases", "systems", "projects", "messages", "conversations", "agents",
    "tenant_join_requests", "tenant_members", "roles", "tenants", "users",
]


def upgrade() -> None:
    for stmt in NEW_TABLES:
        op.execute(stmt)
    for stmt in ALTERS:
        op.execute(stmt)


def downgrade() -> None:
    for col in [
        ("meetings", "status"), ("meetings", "tenant_id"), ("meetings", "created_by"),
        ("requirements", "tenant_id"), ("requirements", "architecture"),
        ("requirements", "design_status"), ("requirements", "created_by"),
        ("dev_tasks", "tenant_id"), ("dev_tasks", "agent_run_id"),
        ("test_runs", "tenant_id"), ("test_runs", "agent_run_id"),
        ("deployments", "tenant_id"), ("deployments", "environment_id"),
        ("deployments", "deployed_by"), ("deployments", "notes"),
        ("deployments", "created_at"),
        ("activity_events", "tenant_id"), ("activity_events", "actor_user_id"),
    ]:
        op.execute(f"ALTER TABLE {col[0]} DROP COLUMN IF EXISTS {col[1]}")
    for table in DROP_ORDER:
        op.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
