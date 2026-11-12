import type { SnapshotBucket, SnapshotObject, SnapshotPutOptions } from '../../../src/common/snapshot-store';

type Stored = { body: string; customMetadata: Record<string, string> };

// In-memory stand-in for the R2 bucket binding: the get/put subset the snapshot store uses.
export class FakeSnapshotBucket implements SnapshotBucket {
  readonly objects = new Map<string, Stored>();
  failing = false;

  async get(key: string): Promise<SnapshotObject | null> {
    if (this.failing) throw new Error('R2 unavailable');
    const stored = this.objects.get(key);
    return stored ? { text: async () => stored.body, customMetadata: { ...stored.customMetadata } } : null;
  }

  async put(key: string, value: string, options: SnapshotPutOptions): Promise<void> {
    if (this.failing) throw new Error('R2 unavailable');
    this.objects.set(key, { body: value, customMetadata: { ...options.customMetadata } });
  }
}
