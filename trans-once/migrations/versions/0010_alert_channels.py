"""alerts: notification channels, delivery log and manual issues; environments: os_type

Revision ID: 0010
Revises: 0009
Create Date: 2026-11-24
"""
from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None

# 已有租户保留自己的角色：只把新权限追加给对应的系统预设角色（做法同 0004）。
ROLE_PERM_APPENDS = [("DevOps 工程师", ["alert.channel.manage"])]


def upgrade() -> None:
    op.execute(
        """CREATE TABLE alert_channels (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            provider TEXT NOT NULL,
            webhook_enc TEXT NOT NULL,
            secret_enc TEXT,
            enabled BOOLEAN NOT NULL DEFAULT TRUE,
            events JSONB NOT NULL DEFAULT '{"monitor": true, "manual": true, "status": false}',
            created_by UUID REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )"""
    )
    op.execute("CREATE INDEX idx_alert_channels_tenant_created ON alert_channels (tenant_id, created_at)")
    op.execute(
        """CREATE TABLE alert_deliveries (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            alert_id UUID REFERENCES alerts(id) ON DELETE CASCADE,
            channel_id UUID REFERENCES alert_channels(id) ON DELETE SET NULL,
            channel_name TEXT NOT NULL,
            provider TEXT NOT NULL,
            event TEXT NOT NULL,
            status TEXT NOT NULL,
            http_status INT,
            error TEXT,
            duration_ms INT,
            created_by UUID REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )"""
    )
    op.execute("CREATE INDEX idx_alert_deliveries_alert ON alert_deliveries (alert_id)")
    op.execute("CREATE INDEX idx_alert_deliveries_tenant_created ON alert_deliveries (tenant_id, created_at DESC)")
    op.execute("ALTER TABLE alerts ADD COLUMN source TEXT NOT NULL DEFAULT 'monitor'")
    op.execute("ALTER TABLE alerts ADD COLUMN notified_user_ids UUID[] NOT NULL DEFAULT '{}'")
    op.execute(
        "ALTER TABLE alerts ADD COLUMN environment_id UUID REFERENCES environments(id) ON DELETE SET NULL"
    )
    op.execute("ALTER TABLE environments ADD COLUMN os_type TEXT NOT NULL DEFAULT 'linux'")
    for name, perms in ROLE_PERM_APPENDS:
        joined = ", ".join(f'"{p}"' for p in perms)
        op.execute(
            f"UPDATE roles SET permissions = permissions || '[{joined}]'::jsonb"
            f" WHERE is_system AND name = '{name}'"
        )


def downgrade() -> None:
    op.execute("ALTER TABLE environments DROP COLUMN IF EXISTS os_type")
    op.execute("ALTER TABLE alerts DROP COLUMN IF EXISTS environment_id")
    op.execute("ALTER TABLE alerts DROP COLUMN IF EXISTS notified_user_ids")
    op.execute("ALTER TABLE alerts DROP COLUMN IF EXISTS source")
    op.execute("DROP TABLE IF EXISTS alert_deliveries")
    op.execute("DROP TABLE IF EXISTS alert_channels")
