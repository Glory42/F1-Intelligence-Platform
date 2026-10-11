import { defineMiddleware } from 'astro:middleware';
import { legacyRedirect } from '@/lib/legacyRedirects';

export const onRequest = defineMiddleware((context, next) => {
  const target = legacyRedirect(context.url.pathname, context.url.search);
  return target ? context.redirect(target, 301) : next();
});
