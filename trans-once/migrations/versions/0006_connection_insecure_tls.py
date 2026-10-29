"""gitlab_connections: optional TLS verification skip for self-signed certs

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-29
"""
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Self-hosted GitLabs commonly serve self-signed/IP certificates; admins
    # can opt out of verification per connection (outbound calls only).
    op.execute(
        "ALTER TABLE gitlab_connections ADD COLUMN insecure_tls BOOLEAN NOT NULL DEFAULT FALSE"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE gitlab_connections DROP COLUMN IF EXISTS insecure_tls")
