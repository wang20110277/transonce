"""codebases can link to a synced git repo (代码管理选取)

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-28
"""
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ON DELETE SET NULL: removing a GitLab connection keeps the codebase row
    # (with its text fields) and only drops the link.
    op.execute(
        "ALTER TABLE codebases ADD COLUMN repo_id UUID REFERENCES git_repos(id) ON DELETE SET NULL"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE codebases DROP COLUMN IF EXISTS repo_id")
