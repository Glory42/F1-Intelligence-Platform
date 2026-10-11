from typing import Any
import psycopg2
import psycopg2.extras
import psycopg2.pool
from src.config import DATABASE_URL

_pool: psycopg2.pool.SimpleConnectionPool | None = None


def _get_pool() -> psycopg2.pool.SimpleConnectionPool:
    global _pool
    if _pool is None:
        _pool = psycopg2.pool.SimpleConnectionPool(
            1, 5, DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor
        )
    return _pool


class _PooledConnection:
    """conn.close() returns the connection to the pool instead of tearing down the
    TCP/TLS session: every job already calls close() in a finally block."""

    def __init__(self, pool: psycopg2.pool.SimpleConnectionPool, conn: Any) -> None:
        self._pool = pool
        self._conn = conn

    def close(self) -> None:
        self._pool.putconn(self._conn)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._conn, name)


def _is_alive(conn: Any) -> bool:
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT 1")
        return True
    except psycopg2.OperationalError:
        return False


def get_conn() -> Any:
    """Neon closes idle connections between auto_runner cycles; validate before handing
    one out and discard+replace it rather than surfacing an SSL error on first query."""
    pool = _get_pool()
    for _ in range(pool.maxconn):
        conn = pool.getconn()
        if _is_alive(conn):
            return _PooledConnection(pool, conn)
        pool.putconn(conn, close=True)
    raise psycopg2.OperationalError("Could not obtain a live database connection")
