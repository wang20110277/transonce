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
        _pool = pool.SimpleConnectionPool(1, 20, DATABASE_URL)
    return _pool


@contextmanager
def cursor(dict_cursor: bool = True):
    """Yield (cursor, conn). Commits on success, rolls back on error."""
    conn = _get_pool().getconn()
    cur = conn.cursor(cursor_factory=RealDictCursor if dict_cursor else None)
    try:
        yield cur, conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        _get_pool().putconn(conn)


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
