import type { APIRoute } from 'astro';
import { loadSitemapSources, renderUrlset, sitemapPaths } from '@/lib/sitemap';

export const GET: APIRoute = async ({ site, url }) => {
  const sources = await loadSitemapSources(new Date().getUTCFullYear());
  const body = renderUrlset(site ?? url, sitemapPaths(sources));
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
