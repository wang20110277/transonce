"""code repos: GitLab connections, synced repositories and repo access flow

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-28
"""
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None

NEW_TABLES = [
    """
    CREATE TABLE gitlab_connections (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        base_url TEXT NOT NULL,
        token_enc TEXT,
        account TEXT,
        mode TEXT NOT NULL DEFAULT 'live',
        status TEXT NOT NULL DEFAULT 'active',
        last_sync_at TIMESTAMPTZ,
        last_error TEXT,
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (tenant_id, name)
    )
    """,
    """
    CREATE TABLE git_repos (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        connection_id UUID NOT NULL REFERENCES gitlab_connections(id) ON DELETE CASCADE,
        external_id TEXT NOT NULL,
        path TEXT NOT NULL,
        name TEXT NOT NULL,
        namespace TEXT,
        web_url TEXT,
        description TEXT,
        default_branch TEXT,
        visibility TEXT,
        archived BOOLEAN NOT NULL DEFAULT FALSE,
        last_activity_at TIMESTAMPTZ,
        fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (connection_id, external_id)
    )
    """,
    """
    CREATE TABLE repo_access_grants (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        repo_id UUID NOT NULL REFERENCES git_repos(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        granted_by UUID REFERENCES users(id) ON DELETE SET NULL,
        granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (repo_id, user_id)
    )
    """,
    """
    CREATE TABLE repo_access_requests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        repo_id UUID NOT NULL REFERENCES git_repos(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        reason TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
        reviewed_at TIMESTAMPTZ,
        review_note TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    "CREATE UNIQUE INDEX repo_requests_pending_key ON repo_access_requests (repo_id, user_id) WHERE status = 'pending'",
    "CREATE INDEX idx_git_repos_tenant ON git_repos (tenant_id, path)",
    "CREATE INDEX idx_repo_requests_tenant ON repo_access_requests (tenant_id, status, created_at DESC)",
    "CREATE INDEX idx_repo_grants_tenant ON repo_access_grants (tenant_id, user_id)",
]

# Existing demo tenants keep their roles; append the new 代码管理 permissions to
# the matching system-role presets so the menu appears without re-seeding.
ROLE_PERM_APPENDS = [
    ("产品负责人", ["repos"]),
    ("研发工程师", ["repos"]),
    ("测试工程师", ["repos"]),
    ("DevOps 工程师", ["repos", "repo.manage", "repo.approve"]),
]


def upgrade() -> None:
    for stmt in NEW_TABLES:
        op.execute(stmt)
    for name, perms in ROLE_PERM_APPENDS:
        joined = ", ".join(f'"{p}"' for p in perms)
        op.execute(
            f"UPDATE roles SET permissions = permissions || '[{joined}]'::jsonb"
            f" WHERE is_system AND name = '{name}'"
        )


def downgrade() -> None:
    for table in ("repo_access_requests", "repo_access_grants", "git_repos", "gitlab_connections"):
        op.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
