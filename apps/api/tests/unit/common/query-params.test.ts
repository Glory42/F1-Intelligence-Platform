import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import app from '../../../src/main';
import { canonicalCacheUrl, readsQuery } from '../../../src/common/query-params';

const readFrom = (url: string) => (name: string) => new URL(url).searchParams.get(name) ?? undefined;

function canonical(url: string, params: readonly string[] | undefined): string {
  return canonicalCacheUrl(url, params, readFrom(url));
}

describe('canonicalCacheUrl', () => {
  test('drops params the route never reads', () => {
    expect(canonical('https://api.test/api/races/7?utm_source=x&b=1', [])).toBe('https://api.test/api/races/7');
  });

  test('keeps the params the route reads in one fixed order', () => {
    expect(canonical('https://api.test/api/races?year=2025&x=1&status=completed', ['year', 'status']))
      .toBe('https://api.test/api/races?status=completed&year=2025');
  });

  test('keys a repeated param on the value the handler reads', () => {
    expect(canonical('https://api.test/api/races?year=2025&year=2024', ['year']))
      .toBe('https://api.test/api/races?year=2025');
  });

  test('leaves the URL alone when the route declares nothing', () => {
    const url = 'https://api.test/api/unknown?b=2&a=1';

    expect(canonical(url, undefined)).toBe(url);
  });
});

describe('readsQuery', () => {
  test('tags the handler with the params it reads and returns the same handler', () => {
    const handler = () => new Response();

    expect(readsQuery(['date'], handler)).toBe(handler);
    expect((handler as { queryParams?: readonly string[] }).queryParams).toEqual(['date']);
  });
});

describe('every API route declares the query params it reads', () => {
  const routes = app.routes.filter((r) => r.method === 'GET' && r.path.startsWith('/api'));

  test.each(routes.map((r) => [r.path, r.handler] as const))('%s', (_, handler) => {
    expect(Array.isArray((handler as { queryParams?: unknown }).queryParams)).toBe(true);
  });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith('.ts') ? [path] : [];
  });
}

// Route factories type-check their query names; a hand-written handler can only be checked here.
describe('a hand-written handler reads only the params it declares', () => {
  const files = sourceFiles(join(import.meta.dir, '../../../src'))
    .filter((path) => !path.endsWith(join('common', 'route.ts')));

  test.each(files.flatMap((path) => {
    const source = readFileSync(path, 'utf8');
    return [...source.matchAll(/c\.req\.queries?\(\s*'(\w+)'/g)].map((m) => [m[1], path, source] as const);
  }))('%s in %s', (name, _, source) => {
    expect(source).toMatch(new RegExp(`readsQuery\\(\\[[^\\]]*'${name}'`));
  });

  test('no handler reads the whole query string', () => {
    const readers = files.filter((path) => /c\.req\.(queries|query)\(\s*\)/.test(readFileSync(path, 'utf8')));

    expect(readers).toEqual([]);
  });
});
