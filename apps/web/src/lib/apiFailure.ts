type Listener = () => void;

let listener: Listener = () => undefined;

// api.ts also runs in browser islands, so the server plugs its per-render tracker in here
// (renderHealth.ts) rather than api.ts importing node:async_hooks.
export function onApiFailure(next: Listener): void {
  listener = next;
}

export function reportApiFailure(): void {
  listener();
}

// A not-found or a bad parameter is the same on every render; anything else may be gone in a minute.
export function isTransientApiStatus(status: number): boolean {
  return status >= 500 || status === 429;
}
