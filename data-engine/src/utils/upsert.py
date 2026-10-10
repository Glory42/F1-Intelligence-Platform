from typing import Any
from psycopg2 import sql
from psycopg2.extras import execute_batch


def upsert(
    conn,
    table: str,
    rows: list[dict[str, Any]],
    conflict_cols: list[str],
    exclude_update: list[str] | None = None,
) -> None:
    """exclude_update skips extra columns in UPDATE SET beyond conflict_cols (e.g. 'status',
    so existing completed rows aren't reset to 'scheduled')."""
    if not rows:
        return

    skip_on_update = set(conflict_cols) | set(exclude_update or [])
    cols = list(rows[0].keys())
    update_cols = [c for c in cols if c not in skip_on_update]

    # The WHERE skips rows whose values are unchanged: re-running a job (worker retries, backfills)
    # then writes nothing, sparing Neon Free dead tuples, history and write volume.
    query = sql.SQL(
        "INSERT INTO {table} ({cols}) VALUES ({placeholders}) "
        "ON CONFLICT ({conflict}) DO UPDATE SET {update_set} "
        "WHERE ({current}) IS DISTINCT FROM ({incoming})"
    ).format(
        table=sql.Identifier(table),
        cols=sql.SQL(", ").join(sql.Identifier(c) for c in cols),
        placeholders=sql.SQL(", ").join(sql.Placeholder() * len(cols)),
        conflict=sql.SQL(", ").join(sql.Identifier(c) for c in conflict_cols),
        update_set=sql.SQL(", ").join(
            sql.SQL("{c} = EXCLUDED.{c}").format(c=sql.Identifier(c)) for c in update_cols
        ),
        current=sql.SQL(", ").join(sql.SQL("{t}.{c}").format(t=sql.Identifier(table), c=sql.Identifier(c)) for c in update_cols),
        incoming=sql.SQL(", ").join(sql.SQL("EXCLUDED.{c}").format(c=sql.Identifier(c)) for c in update_cols),
    )

    with conn.cursor() as cur:
        param_list = [[row[c] for c in cols] for row in rows]
        execute_batch(cur, query, param_list, page_size=200)
    conn.commit()
