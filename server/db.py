"""Postgres access for the transonce backend (psycopg2).

Schema is managed by Alembic migrations under server/migrations/ — run
`alembic upgrade head`. This module only handles the connection pool + helpers.
"""
import os
from contextlib import contextmanager
from psycopg2 import pool
from psycopg2.extras import RealDictCursor

DATABASE_URL = os.getenv(
    "DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/transonce"
)

_pool: pool.SimpleConnectionPool | None = None


def _get_pool() -> pool.SimpleConnectionPool:
    global _pool
    if _pool is None:
        _pool = pool.SimpleConnectionPool(
            1,
            20,
            DATABASE_URL,
            connect_timeout=10,
            application_name="transonce",
        )
    return _pool


def _acquire(p: pool.SimpleConnectionPool):
    """Get a usable connection, discarding ones closed while idle."""
    conn = p.getconn()
    if conn.closed:
        p.putconn(conn, close=True)
        conn = p.getconn()
    return conn


@contextmanager
def cursor(dict_cursor: bool = True):
    """Yield (cursor, conn). Commits on success, rolls back on error."""
    p = _get_pool()
    conn = _acquire(p)
    cur = None
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor if dict_cursor else None)
        yield cur, conn
        conn.commit()
    except Exception:
        try:
            conn.rollback()
        except Exception:
            # The connection itself is gone; the pool will be told below.
            pass
        raise
    finally:
        if cur is not None:
            try:
                cur.close()
            except Exception:
                pass
        # A dead connection must be closed, not returned to the pool, or every
        # later request will dequeue the same broken socket.
        p.putconn(conn, close=bool(conn.closed))


def fetch_all(sql: str, args: tuple | None = None) -> list[dict]:
    with cursor() as (cur, _):
        cur.execute(sql, args)
        return [dict(r) for r in cur.fetchall()]


def fetch_one(sql: str, args: tuple | None = None) -> dict | None:
    with cursor() as (cur, _):
        cur.execute(sql, args)
        row = cur.fetchone()
        return dict(row) if row else None


def execute(sql: str, args: tuple | None = None) -> int:
    """Run a statement and return affected row count."""
    with cursor() as (cur, _):
        cur.execute(sql, args)
        return cur.rowcount


def execute_returning(sql: str, args: tuple | None = None) -> dict | None:
    """For INSERT ... RETURNING * — returns the single row (or None)."""
    with cursor() as (cur, _):
        cur.execute(sql, args)
        row = cur.fetchone()
        return dict(row) if row else None


def recover_stale_runs() -> None:
    """Close runs orphaned by a crash/restart.

    Only rows older than 30 minutes are touched so a second worker starting up
    cannot mark another worker's live run as failed.
    """
    execute(
        """UPDATE agent_runs
           SET status='failed', error=COALESCE(error, '平台重启，任务中断'), ended_at=now()
           WHERE status IN ('queued','running')
             AND started_at < now() - interval '30 minutes'"""
    )
    execute(
        """UPDATE pipeline_runs
           SET status='failed', ended_at=now()
           WHERE status='running' AND started_at < now() - interval '30 minutes'"""
    )
    execute(
        """UPDATE test_runs
           SET status='failed'
           WHERE status IN ('pending','running')
             AND created_at < now() - interval '30 minutes'"""
    )
