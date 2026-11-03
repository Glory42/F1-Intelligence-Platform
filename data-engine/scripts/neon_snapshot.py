"""One read-only pg_dump of Neon restored into a local Postgres: shared by backtest_snapshot.py and
dev_snapshot.py. Reads PROD_DATABASE_URL, else DATABASE_URL, so it works once .env points at the dev DB."""
import os
import pathlib
import subprocess

from src.config import DATABASE_URL


def neon_url() -> str:
    url = os.environ.get("PROD_DATABASE_URL") or DATABASE_URL
    if "neon.tech" not in url:
        raise SystemExit("Set PROD_DATABASE_URL to the Neon connection string to take a snapshot.")
    # pg_dump needs a session, which Neon's transaction-mode pooler doesn't keep: use the direct host.
    return url.replace("-pooler.", ".")


def copy_neon_into(target_url: str, compose_file: str, dump_path: pathlib.Path, skipped_table_data: tuple[str, ...] = ()) -> None:
    subprocess.run(["docker", "compose", "-f", compose_file, "up", "-d", "--wait"], check=True)
    dump_path.parent.mkdir(parents=True, exist_ok=True)
    print("Dumping Neon (read-only)...")
    subprocess.run(
        ["pg_dump", "--format=custom", "--no-owner", "--no-privileges", f"--file={dump_path}",
         *(f"--exclude-table-data={t}" for t in skipped_table_data), neon_url()],
        check=True,
    )
    print(f"Restoring {dump_path.stat().st_size / 1e6:.0f} MB into {target_url.rsplit('/', 1)[-1]}...")
    subprocess.run(
        ["pg_restore", "--clean", "--if-exists", "--no-owner", "--no-privileges", f"--dbname={target_url}", str(dump_path)],
        check=True,
    )
    print("Done.")
