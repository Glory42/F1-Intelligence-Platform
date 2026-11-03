import { beforeEach, describe, expect, it } from 'vitest';
import { pageCacheKey, servePageCached, type PageCache } from '@/lib/pageCache';

class FakePageCache implements PageCache {
  readonly entries = new Map<string, Response>();

  async match(request: Request): Promise<Response | undefined> {
    return this.entries.get(request.url)?.clone();
  }

  async put(request: Request, response: Response): Promise<void> {
    this.entries.set(request.url, response.clone());
  }
}

describe('page cache', () => {
  let cache: FakePageCache;
  let renders: number;
  let pending: Promise<unknown>[];

  const page = (headers: Record<string, string> = {}, status = 200) => async () => {
    renders += 1;
    return new Response(`render ${renders}`, { status, headers: { 'Content-Type': 'text/html', ...headers } });
  };
  const visit = async (render = page(), init: RequestInit = {}, path = '/drivers') => {
    const res = await servePageCached(new Request(`https://f1.example${path}`, init), render, cache, (work) => {
      pending.push(work);
    });
    await Promise.all(pending);
    return res;
  };

  beforeEach(() => {
    cache = new FakePageCache();
    renders = 0;
    pending = [];
  });

  it('serves a repeat visit from the edge instead of rendering again', async () => {
    await visit();
    const res = await visit();

    expect(await res.text()).toBe('render 1');
    expect(renders).toBe(1);
  });

  it('keeps the cache instructions off the copy sent to the browser', async () => {
    const first = await visit();
    const repeat = await visit();

    expect(first.headers.get('Cache-Control')).toBeNull();
    expect(repeat.headers.get('Cache-Control')).toBeNull();
  });

  it('renders separately for a collapsed and an expanded sidebar', async () => {
    await visit(page(), { headers: { Cookie: 'sidebar=collapsed' } });
    const res = await visit(page(), { headers: { Cookie: 'theme=dark; sidebar=expanded' } });

    expect(await res.text()).toBe('render 2');
  });

  it('keys each tab and season variant as its own page', () => {
    const tab = pageCacheKey(new URL('https://f1.example/drivers?tab=racecraft'), null).url;
    const season = pageCacheKey(new URL('https://f1.example/drivers?year=2024'), null).url;

    expect(tab).not.toBe(season);
  });

  it.each([
    ['a missing page', page({}, 404)],
    ['a page that sets a cookie', page({ 'Set-Cookie': 'a=b' })],
    ['a page with its own cache rules', page({ 'Cache-Control': 'private' })],
    ['a non-HTML response', page({ 'Content-Type': 'application/xml' })],
  ])('never stores %s', async (_label, render) => {
    await visit(render);
    await visit(render);

    expect(renders).toBe(2);
  });

  it('always renders when no edge cache is available (astro dev, *.pages.dev)', async () => {
    const res = await servePageCached(new Request('https://f1.example/'), page(), undefined, () => undefined);

    expect(await res.text()).toBe('render 1');
  });
});
