import { defineMiddleware } from 'astro:middleware';
import { legacyRedirect } from '@/lib/legacyRedirects';
import { canonicalHostRedirect } from '@/lib/canonicalHost';
import { defaultPageCache, servePageCached, type RunInBackground } from '@/lib/pageCache';
import { strayQueryRedirect } from '@/lib/pageQuery';
import { securityHeaders, withSecurityHeaders } from '@/lib/securityHeaders';

type CloudflareLocals = { runtime?: { ctx?: { waitUntil: RunInBackground } } };

const SECURITY_HEADERS = securityHeaders(new URL(import.meta.env.PUBLIC_API_URL ?? 'http://localhost:8787').origin);

export const onRequest = defineMiddleware(async (context, next) => {
  const target = canonicalHostRedirect(context.url, context.site)
    ?? legacyRedirect(context.url.pathname, context.url.search)
    ?? strayQueryRedirect(context.url);
  if (target) return withSecurityHeaders(context.redirect(target, 301), SECURITY_HEADERS);

  const ctx = (context.locals as CloudflareLocals).runtime?.ctx;
  const runInBackground: RunInBackground = (work) => (ctx ? ctx.waitUntil(work) : void work);
  const cache = import.meta.env.DEV ? undefined : defaultPageCache();
  const res = await servePageCached(context.request, () => next(), cache, runInBackground);
  return withSecurityHeaders(res, SECURITY_HEADERS);
});
