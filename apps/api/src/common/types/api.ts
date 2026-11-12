import type { SnapshotBucket } from '../snapshot-store';

export type Bindings = {
  DATABASE_URL: string;
  // R2 bucket f1-api-snapshots (wrangler.toml). Bump SNAPSHOT_VERSION after a backfill: see docs/deployment.md.
  SNAPSHOTS?: SnapshotBucket;
  SNAPSHOT_VERSION?: string;
  R2_PUBLIC_URL?: string;
  ENVIRONMENT?: string;
  // Local dev only (.dev.vars): the docker-compose.dev.yml proxy in front of a local Postgres.
  NEON_FETCH_ENDPOINT?: string;
};

export type ApiSuccess<T> = { data: T; error: null };

export type ApiError = { data: null; error: { code: string; message: string } };

export type ApiResponse<T> = ApiSuccess<T> | ApiError;
