// The slice of a Workers KV namespace the API uses: kept local so tests can pass an in-memory one.
export interface KvStore {
  get(key: string): Promise<string | null>;
  getWithMetadata<M>(key: string): Promise<{ value: string | null; metadata: M | null }>;
  put(key: string, value: string, options?: { metadata?: unknown }): Promise<void>;
}

export type Bindings = {
  DATABASE_URL: string;
  R2_PUBLIC_URL?: string;
  ENVIRONMENT?: string;
  API_CACHE?: KvStore;
  // Local dev only (.dev.vars): the docker-compose.dev.yml proxy in front of a local Postgres.
  NEON_FETCH_ENDPOINT?: string;
};

export type ApiSuccess<T> = { data: T; error: null };

export type ApiError = { data: null; error: { code: string; message: string } };

export type ApiResponse<T> = ApiSuccess<T> | ApiError;
