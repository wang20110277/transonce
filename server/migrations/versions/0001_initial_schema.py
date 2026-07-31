"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-06-12
"""
from alembic import op

# revision identifiers, used by Alembic.
revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

TABLES = [
    """
    CREATE TABLE meetings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID,
        title TEXT NOT NULL,
        raw_notes TEXT NOT NULL,
        transcript TEXT,
        participants JSONB NOT NULL DEFAULT '[]',
        source TEXT NOT NULL DEFAULT 'manual',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    """
    CREATE TABLE requirements (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        priority TEXT,
        acceptance_criteria JSONB NOT NULL DEFAULT '[]',
        source_meeting_id UUID REFERENCES meetings(id) ON DELETE SET NULL,
        prototype TEXT,
        artifact TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    """
    CREATE TABLE dev_tasks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        requirement_id UUID NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT,
        assignee_kind TEXT NOT NULL DEFAULT 'agent',
        assignee_id TEXT,
        status TEXT NOT NULL DEFAULT 'queued',
        estimate TEXT,
        acceptance_criteria JSONB NOT NULL DEFAULT '[]',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    """
    CREATE TABLE test_runs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        requirement_id UUID NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'pending',
        cases JSONB NOT NULL DEFAULT '[]',
        passed INT NOT NULL DEFAULT 0,
        total INT NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    """
    CREATE TABLE deployments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        artifact_id UUID NOT NULL,
        environment TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        url TEXT,
        deployed_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    """
    CREATE TABLE activity_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID,
        actor_kind TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        type TEXT NOT NULL,
        payload JSONB NOT NULL DEFAULT '{}',
        at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
]

DROP_ORDER = ["activity_events", "deployments", "test_runs", "dev_tasks", "requirements", "meetings"]


def upgrade() -> None:
    for stmt in TABLES:
        op.execute(stmt)


def downgrade() -> None:
    for table in DROP_ORDER:
        op.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
