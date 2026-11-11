import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PAGE_QUERY_PARAMS, canonicalPageSearch, strayQueryRedirect } from '@/lib/pageQuery';

const url = (pathAndQuery: string) => new URL(`https://f1.example${pathAndQuery}`);

describe('strayQueryRedirect', () => {
  it('leaves a URL alone when every param is one a page reads', () => {
    expect(strayQueryRedirect(url('/drivers?year=2024&tab=title-odds'))).toBeNull();
    expect(strayQueryRedirect(url('/drivers'))).toBeNull();
  });

  it('sends a URL with params no page reads to the same page without them', () => {
    expect(strayQueryRedirect(url('/drivers?utm_source=x&year=2024&fbclid=1'))).toBe('/drivers?year=2024');
  });

  it('drops the query string altogether when nothing in it is read', () => {
    expect(strayQueryRedirect(url('/races/12?ref=feed'))).toBe('/races/12');
  });
});

describe('canonicalPageSearch', () => {
  it('orders the params so the same page view shares one cache key', () => {
    expect(canonicalPageSearch(url('/drivers?year=2024&tab=racecraft')))
      .toBe(canonicalPageSearch(url('/drivers?tab=racecraft&year=2024')));
  });

  it('keys a repeated param on the first value, the one a page reads', () => {
    expect(canonicalPageSearch(url('/races?year=2024&year=2023'))).toBe('?year=2024');
  });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(astro|ts|tsx)$/.test(path) ? [path] : [];
  });
}

// A param missing from the list would be redirected away before the page could read it.
describe('every query param read in src is on the list', () => {
  const reads = sourceFiles(join(__dirname, '../../../src')).flatMap((path) =>
    [...readFileSync(path, 'utf8').matchAll(/[pP]arams\.get\(\s*['"](\w+)['"]/g)].map((m) => [m[1], path] as const));

  it('finds the reads it is meant to check', () => {
    expect(reads.length).toBeGreaterThan(5);
  });

  it.each(reads)('%s in %s', (name) => {
    expect(PAGE_QUERY_PARAMS).toContain(name);
  });
});
