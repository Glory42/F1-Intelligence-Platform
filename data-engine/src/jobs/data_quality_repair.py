"""Resolves fixable gaps data_quality_audit found by re-running, for each affected race, the chain
steps that own the gap's table (weekend_pipeline.repair_plan)."""
from typing import Any

from src.db.client import get_conn
from src.weekend_pipeline import RaceRunContext, repair_plan


def _load_issues(year: int, resolve_run: int | None) -> tuple[int | None, list[dict[str, Any]]]:
    """(audit run id, its fixable issues with every round_number filled in)."""
    conn = get_conn()
    try:
        if resolve_run:
            base_sql = "SELECT id FROM data_quality_runs WHERE id=%s"
            params: tuple = (resolve_run,)
        else:
            base_sql = ("SELECT id FROM data_quality_runs WHERE year=%s "
                        "ORDER BY generated_at DESC LIMIT 1")
            params = (int(year),)
        with conn.cursor() as cur:
            cur.execute(base_sql, params)
            row = cur.fetchone()
        if not row:
            return None, []
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, race_id, round_number, year, table_name, check_name, "
                "severity, detail, fixable, is_sprint "
                "FROM data_quality_issues WHERE run_id=%s AND fixable=true",
                (row["id"],),
            )
            issues = [dict(i) for i in cur.fetchall()]
        rounds: dict[int, int | None] = {}
        for issue in issues:
            if not issue["round_number"]:
                if issue["race_id"] not in rounds:
                    with conn.cursor() as cur:
                        cur.execute("SELECT round_number FROM races WHERE id = %s", (issue["race_id"],))
                        found = cur.fetchone()
                    rounds[issue["race_id"]] = found["round_number"] if found else None
                issue["round_number"] = rounds[issue["race_id"]]
        return row["id"], issues
    finally:
        conn.close()


def _mark_resolved(issue_ids: list[int]) -> None:
    conn = get_conn()
    try:
        for issue_id in issue_ids:
            with conn.cursor() as cur:
                cur.execute("UPDATE data_quality_issues SET resolved=true WHERE id=%s", (issue_id,))
        conn.commit()
    finally:
        conn.close()


def run(year: int, resolve_run: int | None = None) -> None:
    # No connection is held while the jobs run: each opens its own around its FastF1/OpenF1 calls.
    run_id, issues = _load_issues(year, resolve_run)
    if run_id is None:
        print(f"[data_quality_repair] no audit run for year={year} resolve={resolve_run}; nothing to do")
        return
    if not issues:
        print(f"[data_quality_repair] run {run_id}: no fixable issues")
        return

    print(f"[data_quality_repair] run {run_id}: {len(issues)} fixable issues")
    # Grouped by race so several issues on one race share one pass through its chains.
    skipped = 0
    grouped: dict[tuple[int, int, int | None], list[dict[str, Any]]] = {}
    for issue in issues:
        if not repair_plan([(issue["table_name"], issue["check_name"])]):
            print(f"  [skip] no repair path for {issue['table_name']}.{issue['check_name']}")
            skipped += 1
            continue
        grouped.setdefault((issue["race_id"], issue["year"], issue["round_number"]), []).append(issue)

    fixed = failed = 0
    for (race_id, race_year, round_num), group in grouped.items():
        steps = repair_plan([(i["table_name"], i["check_name"]) for i in group])
        names = ",".join(s.name for s in steps)
        try:
            if round_num is None:
                raise ValueError(f"cannot resolve round for issue race {race_id}")
            ctx = RaceRunContext(race_id=race_id, year=race_year, round_number=round_num)
            for step in steps:
                step.run(ctx)
            _mark_resolved([i["id"] for i in group])
            fixed += len(group)
            print(f"  [OK] race={round_num} steps={names} resolved {len(group)} issue(s)")
        except Exception as e:
            print(f"  [FAIL] race={round_num or race_id} steps={names}: {e}")
            failed += len(group)
    print(f"[data_quality_repair] done: fixed={fixed} failed={failed} skipped={skipped}")
