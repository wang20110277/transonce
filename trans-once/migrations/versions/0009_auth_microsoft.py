"""auth: Microsoft login, configurable password/registration switches

Revision ID: 0009
Revises: 0008
Create Date: 2026-10-30
"""
from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Microsoft auto-registered accounts have no password; auth_provider records
    # how the account was created (password | microsoft).
    op.execute("ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL")
    op.execute("ALTER TABLE users ADD COLUMN auth_provider TEXT NOT NULL DEFAULT 'password'")
    # Platform-wide runtime settings (login switches, Microsoft OAuth client).
    op.execute(
        """CREATE TABLE platform_settings (
            key TEXT PRIMARY KEY,
            value JSONB NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )"""
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS platform_settings")
    # Existing microsoft-created users would violate NOT NULL; give them an
    # unusable random hash before restoring the constraint.
    op.execute(
        """UPDATE users SET password_hash = 'pbkdf2$0$$' WHERE password_hash IS NULL"""
    )
    op.execute("ALTER TABLE users ALTER COLUMN password_hash SET NOT NULL")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS auth_provider")
