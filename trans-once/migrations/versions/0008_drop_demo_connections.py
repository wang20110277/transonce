"""drop demo-mode GitLab connections (offline catalog feature removed)

Revision ID: 0008
Revises: 0007
Create Date: 2026-10-30
"""
from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Demo connections (and their synced repos, grants and requests via
    # cascades) are fake data; the feature no longer exists. Connections in
    # live mode and their synced repos are untouched.
    op.execute("DELETE FROM gitlab_connections WHERE mode='demo'")


def downgrade() -> None:
    pass
