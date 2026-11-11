import { TAB_PARAM } from '@/lib/pageTabs';

// Every query param a page or island reads (a test checks src against this list). Anything else
// is redirected away, so a crawler can't render and cache one page under endless padded URLs.
export const PAGE_QUERY_PARAMS: readonly string[] = ['a', 'b', 'career', 'date', 'filter', 'session', 'sort', TAB_PARAM, 'year'];

// First value of each param, as searchParams.get returns it, in a fixed order.
export function canonicalPageSearch(url: URL): string {
  const canonical = new URLSearchParams();
  for (const name of [...PAGE_QUERY_PARAMS].sort()) {
    const value = url.searchParams.get(name);
    if (value !== null) canonical.set(name, value);
  }
  const search = canonical.toString();
  return search ? `?${search}` : '';
}

export function strayQueryRedirect(url: URL): string | null {
  const stray = [...url.searchParams.keys()].some((name) => !PAGE_QUERY_PARAMS.includes(name));
  return stray ? url.pathname + canonicalPageSearch(url) : null;
}
