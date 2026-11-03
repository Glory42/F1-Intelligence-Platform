import type { KvStore } from '../../../src/common/types';

type Stored = { value: string; metadata: unknown };

// In-memory stand-in for a Workers KV namespace: same get/getWithMetadata/put shape.
export class FakeKv implements KvStore {
  readonly entries = new Map<string, Stored>();
  failWrites = false;
  failReads = false;

  async get(key: string): Promise<string | null> {
    if (this.failReads) throw new Error('KV get failed: daily read limit exceeded');
    return this.entries.get(key)?.value ?? null;
  }

  async getWithMetadata<M>(key: string): Promise<{ value: string | null; metadata: M | null }> {
    if (this.failReads) throw new Error('KV get failed: daily read limit exceeded');
    const stored = this.entries.get(key);
    return { value: stored?.value ?? null, metadata: (stored?.metadata as M | undefined) ?? null };
  }

  async put(key: string, value: string, options?: { metadata?: unknown }): Promise<void> {
    if (this.failWrites) throw new Error('KV put failed: daily write limit exceeded');
    this.entries.set(key, { value, metadata: options?.metadata ?? null });
  }

  setState(state: { version?: string; serveStale?: boolean }): void {
    this.entries.set('meta:state', { value: JSON.stringify(state), metadata: null });
  }
}
