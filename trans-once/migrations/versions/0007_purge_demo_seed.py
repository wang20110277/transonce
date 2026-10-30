"""purge seeded demo data; installs keep only the super admin

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-30
"""
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None

# The former seed.py created a demo tenant (slug `innovatech`) with demo
# accounts. seed.py now bootstraps only the super admin; this migration
# removes whatever the old seed left behind. All tenant-scoped rows cascade
# from tenants(id); demo users cascade their memberships/grants.


def upgrade() -> None:
    op.execute("DELETE FROM tenants WHERE slug='innovatech'")
    op.execute(
        "DELETE FROM users WHERE lower(email) IN ('product@transonce.local', 'dev@transonce.local')"
    )


def downgrade() -> None:
    # Seed data is not restorable by downgrade — re-running the old seed is
    # the (unsupported) way back.
    pass
