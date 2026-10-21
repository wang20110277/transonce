"""indexes for tenant-scoped list endpoints

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-21

Every list endpoint filters by tenant_id and orders by a timestamp; without
composite indexes PostgreSQL falls back to a sequential scan + sort as soon as
a tenant accumulates data.
"""
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None

INDEXES = [
    ("idx_requirements_tenant_created", "requirements (tenant_id, created_at DESC)"),
    ("idx_tasks_tenant_created", "dev_tasks (tenant_id, created_at DESC)"),
    ("idx_test_runs_tenant_created", "test_runs (tenant_id, created_at DESC)"),
    ("idx_artifacts_tenant_created", "artifacts (tenant_id, created_at DESC)"),
    ("idx_pipelines_tenant_created", "pipelines (tenant_id, created_at DESC)"),
    ("idx_pipeline_runs_tenant_started", "pipeline_runs (tenant_id, started_at DESC)"),
    ("idx_deployments_tenant_deployed", "deployments (tenant_id, deployed_at DESC)"),
    ("idx_monitors_tenant_created", "monitors (tenant_id, created_at)"),
    ("idx_environments_tenant_created", "environments (tenant_id, created_at)"),
    ("idx_agents_tenant_created", "agents (tenant_id, created_at)"),
    ("idx_agent_runs_tenant_started", "agent_runs (tenant_id, started_at DESC)"),
    ("idx_conversations_tenant_user_updated", "conversations (tenant_id, user_id, updated_at DESC)"),
    ("idx_members_tenant_status", "tenant_members (tenant_id, status)"),
]


def upgrade() -> None:
    for name, target in INDEXES:
        op.execute(f"CREATE INDEX IF NOT EXISTS {name} ON {target}")


def downgrade() -> None:
    for name, _ in INDEXES:
        op.execute(f"DROP INDEX IF EXISTS {name}")
