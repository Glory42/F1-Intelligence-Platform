import pytest

from src.utils.storage_guard import StorageTier, read_storage_tier, storage_tier
from tests.support.fake_db import FakeConnection

MB = 1_000_000


class TestStorageTier:
    @pytest.mark.parametrize(
        ("db_bytes", "expected"),
        [
            (70 * MB, StorageTier.ALLOW_ALL),
            (400 * MB, StorageTier.ALLOW_ALL),
            (500 * MB, StorageTier.BLOCK_BACKFILL),
            (600 * MB, StorageTier.BLOCK_BACKFILL),
            (750 * MB, StorageTier.CORE_ONLY),
            (800 * MB, StorageTier.CORE_ONLY),
        ],
    )
    def test_tier_for_size_against_neon_free_1gb(self, db_bytes: int, expected: StorageTier):
        assert storage_tier(db_bytes) is expected

    def test_custom_limit_scales_thresholds(self):
        assert storage_tier(60 * MB, limit_bytes=100 * MB) is StorageTier.BLOCK_BACKFILL

    def test_backfills_allowed_only_in_allow_all(self):
        assert StorageTier.ALLOW_ALL.allows_backfill
        assert not StorageTier.BLOCK_BACKFILL.allows_backfill
        assert not StorageTier.CORE_ONLY.allows_backfill

    def test_optional_feature_writes_blocked_only_in_core_only(self):
        assert StorageTier.ALLOW_ALL.allows_optional
        assert StorageTier.BLOCK_BACKFILL.allows_optional
        assert not StorageTier.CORE_ONLY.allows_optional


class TestReadStorageTier:
    def test_reads_current_database_size(self):
        conn = FakeConnection([{"db_bytes": 620 * MB}])
        assert read_storage_tier(conn) is StorageTier.BLOCK_BACKFILL
