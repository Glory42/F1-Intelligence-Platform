import { defineMiddleware } from 'astro:middleware';
import { legacyRedirect } from '@/lib/legacyRedirects';
import { canonicalHostRedirect } from '@/lib/canonicalHost';
import { defaultPageCache, servePageCached, type RunInBackground } from '@/lib/pageCache';

type CloudflareLocals = { runtime?: { ctx?: { waitUntil: RunInBackground } } };

export const onRequest = defineMiddleware((context, next) => {
  const target = canonicalHostRedirect(context.url, context.site)
    ?? legacyRedirect(context.url.pathname, context.url.search);
  if (target) return context.redirect(target, 301);

  const ctx = (context.locals as CloudflareLocals).runtime?.ctx;
  const runInBackground: RunInBackground = (work) => (ctx ? ctx.waitUntil(work) : void work);
  const cache = import.meta.env.DEV ? undefined : defaultPageCache();
  return servePageCached(context.request, () => next(), cache, runInBackground);
});
