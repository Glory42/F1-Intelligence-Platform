// The project's own <name>.pages.dev address sits outside the zone: no WAF rules, no zone robots.txt
// and no edge cache, so a crawler there renders every page. Preview builds (<id>.<name>.pages.dev) stay.
export function canonicalHostRedirect(url: URL, site: URL | undefined): string | null {
  if (!site || !url.hostname.endsWith('.pages.dev')) return null;
  const productionAlias = url.hostname.split('.').length === 3;
  return productionAlias ? new URL(url.pathname + url.search, site).toString() : null;
}
