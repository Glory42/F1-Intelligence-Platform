export interface PageTab<T extends string = string> {
  id: T;
  label: string;
  /** Set when the tab is its own route rather than a ?tab= view of this page. */
  href?: string;
}

export const TAB_PARAM = 'tab';

export function resolveTab<T extends string>(url: URL, tabs: readonly PageTab<T>[]): T {
  const requested = url.searchParams.get(TAB_PARAM);
  return tabs.find((t) => t.id === requested)?.id ?? tabs[0].id;
}

// The default tab is left out so each page's canonical URL stays the plain one.
export function tabHref<T extends string>(url: URL, tabs: readonly PageTab<T>[], id: T): string {
  const params = new URLSearchParams(url.search);
  if (id === tabs[0].id) params.delete(TAB_PARAM);
  else params.set(TAB_PARAM, id);
  const query = params.toString();
  return query ? `${url.pathname}?${query}` : url.pathname;
}

// The same open tab in another season, optionally on another path (season-scoped driver/team ids).
export function seasonTabHref<T extends string>(
  url: URL, tabs: readonly PageTab<T>[], id: T, year: number, pathname = url.pathname,
): string {
  const target = new URL(url);
  target.pathname = pathname;
  target.searchParams.set('year', String(year));
  return tabHref(target, tabs, id);
}
