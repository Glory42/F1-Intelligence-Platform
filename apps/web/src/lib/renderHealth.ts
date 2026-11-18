import { AsyncLocalStorage } from 'node:async_hooks';
import { onApiFailure } from '@/lib/apiFailure';

interface RenderHealth {
  degraded: boolean;
}

const current = new AsyncLocalStorage<RenderHealth>();

onApiFailure(() => {
  const health = current.getStore();
  if (health) health.degraded = true;
});

// A render that saw an API outage shows a fallback; it must not be kept as the page.
export function trackRenderHealth<T>(work: (health: RenderHealth) => Promise<T>): Promise<T> {
  const health: RenderHealth = { degraded: false };
  return current.run(health, () => work(health));
}

export function isRenderDegraded(): boolean {
  return current.getStore()?.degraded ?? false;
}

// A page whose main record is missing: a real 404, or a 503 when the API couldn't be reached.
export function missingPageStatus(found: boolean): number {
  if (found) return 200;
  return isRenderDegraded() ? 503 : 404;
}
