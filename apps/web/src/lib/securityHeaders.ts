
export type SecurityHeaders = Record<string, string>;

// Astro's ClientRouter appends an empty `data:` module script on every client-side navigation, so
// script-src allows data:; 'unsafe-inline' is already needed for its inline island scripts.
export function securityHeaders(apiOrigin: string): SecurityHeaders {
  const policy = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' data: https://static.cloudflareinsights.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https:",
    "media-src 'self' https:",
    `connect-src 'self' ${apiOrigin} https://cloudflareinsights.com`,
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
  ];
  return {
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Content-Security-Policy': policy.join('; '),
  };
}

// A fresh Response: redirects and cache hits come back with immutable headers.
export function withSecurityHeaders(res: Response, headers: SecurityHeaders): Response {
  const secured = new Response(res.body, res);
  for (const [name, value] of Object.entries(headers)) secured.headers.set(name, value);
  return secured;
}
