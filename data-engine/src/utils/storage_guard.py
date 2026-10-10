from enum import Enum
from typing import Any

# Neon Free caps each project at 1 GB; once full, every INSERT/UPDATE/DELETE fails.
NEON_FREE_STORAGE_BYTES = 1_000_000_000
_BLOCK_BACKFILL_RATIO = 0.50
_CORE_ONLY_RATIO = 0.75


class StorageTier(Enum):
    ALLOW_ALL = "allow_all"
    BLOCK_BACKFILL = "block_backfill"
    CORE_ONLY = "core_only"

    @property
    def allows_backfill(self) -> bool:
        return self is StorageTier.ALLOW_ALL

    @property
    def allows_optional(self) -> bool:
        return self is not StorageTier.CORE_ONLY


def storage_tier(db_bytes: int, limit_bytes: int = NEON_FREE_STORAGE_BYTES) -> StorageTier:
    ratio = db_bytes / limit_bytes
    if ratio >= _CORE_ONLY_RATIO:
        return StorageTier.CORE_ONLY
    if ratio >= _BLOCK_BACKFILL_RATIO:
        return StorageTier.BLOCK_BACKFILL
    return StorageTier.ALLOW_ALL


def read_storage_tier(conn: Any, limit_bytes: int = NEON_FREE_STORAGE_BYTES) -> StorageTier:
    with conn.cursor() as cur:
        cur.execute("SELECT pg_database_size(current_database()) AS db_bytes")
        row = cur.fetchone()
    return storage_tier(int(row["db_bytes"]), limit_bytes)
