"""Measures per-table data completeness across the DB, writes results to
data_quality_runs/issues. Runs in Python since the API stays read-only."""
import json
from typing import Any

from psycopg2.extras import execute_batch

from src.db.client import get_conn
from src.utils.quality_utils import health_from_issues, is_fixable
from src.weekend_pipeline import is_sprint_weekend

# FP2 coverage below this triggers a flag: mirrors compute_features' fallback gate.
FP2_COVERAGE_GATE = 0.7
# Per-lap coverage below which a race is flagged. F1 fields normally retire mid-race,
# so ~70-85% of (drivers × circuit lap_count) is healthy; only flag clearly-degraded sets.
LAP_COVERAGE_GATE = 0.55


def _query(conn, sql: str, params=()) -> list[dict]:
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return list(cur.fetchall())


def _scalar(conn, sql: str, params=()) -> Any:
    rows = _query(conn, sql, params)
    if not rows:
        return None
    key = list(rows[0].keys())[0]
    return rows[0][key]


def _load_races(conn, year: int | None, all_years: bool) -> list[dict]:
    where, params = ("TRUE", ())
    if not all_years and year is not None:
        where, params = "s.year = %s", (year,)
    return _query(
        conn,
        f"""
        SELECT r.id, r.round_number, r.name, r.status, r.event_format, r.season_id,
               s.year, COALESCE(c.lap_count, 0) AS lap_count,
               (SELECT COUNT(*) FROM qualifying_results WHERE race_id = r.id) AS quali_count,
               (SELECT COUNT(*) FROM race_results WHERE race_id = r.id) AS result_count
        FROM races r
        JOIN seasons s ON r.season_id = s.id
        LEFT JOIN circuits c ON r.circuit_id = c.id
        WHERE {where}
        ORDER BY s.year, r.round_number
        """,
        params,
    )


def _audit_race(conn, race: dict, *, run_season_stats: bool) -> tuple[list[dict], float]:
    issues: list[dict[str, Any]] = []
    race_id = race["id"]
    round_number = race["round_number"]
    year = race["year"]
    status = race["status"]
    is_sprint = is_sprint_weekend(race["event_format"])
    quali_count = race["quali_count"]
    result_count = race["result_count"]
    # Cross-table counts avoid a tautological self-check; ~20-car grid is the pre-race fallback.
    expected_grid = quali_count or 20
    lap_count = race.get("lap_count") or 0

    def add(table_name, check_name, severity, detail):
        issues.append({
            "race_id": race_id, "round_number": round_number, "year": year,
            "table_name": table_name, "check_name": check_name,
            "severity": severity, "detail": detail,
            "fixable": is_fixable(table_name, check_name),
            "is_sprint": is_sprint,
        })

    # qualifying_results: pre-2018 legacy eras intentionally lack this data, so only
    # FastF1-era rounds are measured.
    if status in ("qualifying_done", "completed") and year >= 2018:
        # Cross-check against race_results (independent reference) when available.
        quali_expected = result_count if result_count else 20
        if quali_count < max(int(quali_expected * 0.9), 1):
            add("qualifying_results", "row_count", "high",
                f"expected ~{quali_expected} rows, found {quali_count}")

        gaps = _scalar(conn, """
            SELECT string_agg(grid_position::text, ',')
            FROM (SELECT grid_position, COUNT(*) n
                  FROM qualifying_results WHERE race_id = %s
                  GROUP BY grid_position HAVING COUNT(*) > 1) t
            """, (race_id,))
        if gaps:
            add("qualifying_results", "grid_duplicates", "medium",
                f"duplicate grid positions: {gaps}")

        missing_times = _scalar(conn, """
            SELECT COUNT(*) FROM qualifying_results
            WHERE race_id = %s AND COALESCE(q1_time_ms, q2_time_ms, q3_time_ms, 0) = 0
            """, (race_id,))
        if missing_times:
            add("qualifying_results", "q_time_present", "medium",
                f"{missing_times} drivers with no Q time set")

        sector_cov = _scalar(conn, """
            SELECT (COUNT(sector1_ms IS NOT NULL OR NULL)
                  + COUNT(sector2_ms IS NOT NULL OR NULL)
                  + COUNT(sector3_ms IS NOT NULL OR NULL))
                  / (3.0 * NULLIF(COUNT(*), 0))
            FROM qualifying_results WHERE race_id = %s
            """, (race_id,))
        if sector_cov is not None and sector_cov < 0.9:
            add("qualifying_results", "sector_times", "low",
                f"sector coverage {sector_cov:.0%}")

    # ── race_results ──────────────────────────────────────────────────────
    if status == "completed":
        if result_count < max(10, expected_grid):
            add("race_results", "row_count", "high",
                f"expected ~{expected_grid}, got {result_count}")
        if not _scalar(conn, "SELECT 1 FROM race_results WHERE race_id = %s AND finish_position = 1",
                       (race_id,)):
            add("race_results", "winner_present", "high", "no finish_position=1 row")
        mp = _scalar(conn, "SELECT COUNT(*) FROM race_results WHERE race_id = %s AND points IS NULL",
                     (race_id,))
        if mp:
            add("race_results", "points_present", "low", f"{mp} drivers have NULL points")

    # ── lap_times (2018+) ─────────────────────────────────────────────────
    if status == "completed" and year >= 2018 and lap_count > 0:
        r = _query(conn, """
            SELECT COUNT(*) AS laps, COUNT(DISTINCT driver_id) AS drivers,
                   COUNT(*) FILTER (WHERE lap_time_ms IS NULL OR lap_time_ms <= 0) AS null_times
            FROM lap_times WHERE race_id = %s
            """, (race_id,))[0]
        drivers = r["drivers"]
        coverage = (r["laps"] / (drivers * lap_count)) if drivers else 0.0
        if coverage < LAP_COVERAGE_GATE:
            add("lap_times", "lap_coverage",
                "medium" if coverage >= 0.5 else "high",
                f"coverage {coverage:.0%} ({r['laps']} laps, expected ~{drivers}×{lap_count})")
        if r["null_times"]:
            add("lap_times", "lap_time_present", "low",
                f"{r['null_times']} laps missing lap_time_ms")

        if is_sprint:
            spr = _scalar(conn,
                "SELECT COUNT(*) FROM sprint_results WHERE race_id = %s", (race_id,)) or 0
            if spr < max(10, expected_grid):
                add("sprint_results", "row_count", "high",
                    f"expected ~{expected_grid} sprint results, got {spr}")
            sr = _query(conn, """
                SELECT COUNT(DISTINCT (race_id || ':' || driver_id || ':' || lap_number)) AS n
                FROM sprint_lap_times WHERE race_id = %s
                """, (race_id,))[0]
            if not sr["n"]:
                add("sprint_lap_times", "lap_coverage", "low",
                    "no sprint laps ingested for a completed sprint weekend")

    # Sprint weekends use FP1 not FP2, so only conventional weekends are measured here:
    # low coverage is informational (the model falls back to historical circuit pace).
    if (status in ("qualifying_done", "completed") and year >= 2018
            and expected_grid > 0 and not is_sprint):
        fp2_drivers = _scalar(conn,
            "SELECT COUNT(DISTINCT driver_id) FROM fp2_long_run_times WHERE race_id = %s",
            (race_id,)) or 0
        coverage = fp2_drivers / expected_grid
        if coverage < FP2_COVERAGE_GATE:
            add("fp2_long_run_times", "driver_coverage", "low",
                f"FP2 long-run coverage {coverage:.0%} ({fp2_drivers}/~{expected_grid} drivers); "
                f"model falls back to historical circuit pace")

    # Season-scoped aggregate: emit only on the season's first completed race so it
    # isn't duplicated across every race.
    if status == "completed" and run_season_stats:
        missing = _scalar(conn, """
            SELECT COUNT(*) FROM drivers d
            WHERE d.season_id = %s AND NOT EXISTS (
                SELECT 1 FROM driver_season_stats dss
                WHERE dss.driver_id = d.id AND dss.season_id = d.season_id
            )
            """, (race["season_id"],))
        if missing:
            add("driver_season_stats", "driver_presence", "medium",
                f"{missing} drivers missing season stats")

    # ── prediction pipeline (qualifying onwards) ──────────────────────────
    if status in ("qualifying_done", "completed"):
        fc = _scalar(conn,
            "SELECT COUNT(*) FROM driver_prediction_features WHERE race_id = %s", (race_id,)) or 0
        if fc < max(15, int(expected_grid * 0.9)):
            add("driver_prediction_features", "feature_rows", "high",
                f"expected ~{expected_grid} feature rows, got {fc}")
        prob_sum = _scalar(conn,
            "SELECT SUM(win_probability) FROM driver_prediction_features WHERE race_id = %s",
            (race_id,))
        if prob_sum is not None and abs(float(prob_sum) - 1.0) > 0.01:
            add("driver_prediction_features", "probability_sum", "medium",
                f"win_probability sums to {float(prob_sum):.3f}")
    if status == "completed" and not _scalar(
            conn, "SELECT 1 FROM race_predictions WHERE race_id = %s", (race_id,)):
        add("race_predictions", "prediction_present", "high",
            "completed race has no race_predictions row")

    health = health_from_issues(issues)
    return issues, health


def run(year: int | None = None, all_years: bool = False) -> None:
    conn = get_conn()
    try:
        races = _load_races(conn, year, all_years)
        all_issues: list[dict[str, Any]] = []
        total_health = 0.0
        # Season stats are season-scoped; emit them once per season (on the first
        # completed race) rather than duplicating the same gap across every race.
        season_stats_emitted: set[int] = set()
        for race in races:
            run_season_stats = (
                race["status"] == "completed"
                and race["season_id"] not in season_stats_emitted
            )
            if run_season_stats:
                season_stats_emitted.add(race["season_id"])
            issues, health = _audit_race(conn, race, run_season_stats=run_season_stats)
            all_issues.extend(issues)
            total_health += health

        overall = round(total_health / len(races), 2) if races else 0.0
        summary = {
            "races_audited": len(races),
            "issue_count": len(all_issues),
            "fixable_count": sum(1 for i in all_issues if i["fixable"]),
            "by_severity": {
                sev: sum(1 for i in all_issues if i["severity"] == sev)
                for sev in ("high", "medium", "low")
            },
            "by_table": {},
        }
        for i in all_issues:
            summary["by_table"].setdefault(i["table_name"], 0)
            summary["by_table"][i["table_name"]] += 1

        # year_key=0 marks an all-years scan; the partial unique index (year) WHERE
        # race_id IS NULL makes re-running the same year's audit an upsert, not a new row.
        year_key = year if not all_years and year is not None else 0
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO data_quality_runs (year, race_id, generated_at, health_score, summary) "
                "VALUES (%s, NULL, now(), %s, %s::jsonb) "
                "ON CONFLICT (year) WHERE race_id IS NULL "
                "DO UPDATE SET generated_at = now(), health_score = EXCLUDED.health_score, "
                "              summary = EXCLUDED.summary "
                "RETURNING id",
                (year_key, overall, json.dumps(summary)),
            )
            run_id = cur.fetchone()["id"]

        # Replace every issue row for this run so a re-audit never leaves stale entries
        # behind (driving the same idempotent behaviour as the run row itself).
        with conn.cursor() as cur:
            cur.execute("DELETE FROM data_quality_issues WHERE run_id = %s", (run_id,))
            replaced_issues = cur.rowcount

        if all_issues:
            for issue in all_issues:
                issue["run_id"] = run_id
            cols = list(all_issues[0].keys())
            col_sql = ",".join('"{}"'.format(c) for c in cols)
            with conn.cursor() as cur:
                execute_batch(
                    cur,
                    "INSERT INTO data_quality_issues ({}) "
                    "VALUES ({})".format(col_sql, ",".join(["%s"] * len(cols))),
                    [[issue[c] for c in cols] for issue in all_issues],
                )
        conn.commit()
        print(f"[data_quality_audit] year={year} all={all_years} races={len(races)} "
              f"issues={len(all_issues)} health={overall} "
              f"(replaced {replaced_issues} prior issue rows for run {run_id})")
    finally:
        conn.close()