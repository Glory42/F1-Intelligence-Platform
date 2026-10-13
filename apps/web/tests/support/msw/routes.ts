import { http, HttpResponse } from 'msw';
import { server } from './server';

const API_URL = 'http://localhost:8787';

export function apiOk(path: string, data: unknown) {
  return http.get(`${API_URL}${path}`, () => HttpResponse.json({ data, error: null }));
}

export function apiError(path: string, status = 500) {
  return http.get(`${API_URL}${path}`, () =>
    HttpResponse.json({ data: null, error: { code: 'ERROR', message: `failed ${path}` } }, { status }),
  );
}

// Every API path (with query) requested while a test runs, so it can assert what a loader fetched.
export function recordApiRequests(): string[] {
  const seen: string[] = [];
  const listener = ({ request }: { request: Request }) => {
    const url = new URL(request.url);
    seen.push(`${url.pathname}${url.search}`);
  };
  server.events.on('request:start', listener);
  return seen;
}
