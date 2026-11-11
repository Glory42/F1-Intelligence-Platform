import { describe, expect, it } from 'vitest';
import { securityHeaders, withSecurityHeaders } from '@/lib/securityHeaders';

const API = 'https://f1-api.example';

describe('securityHeaders', () => {
  const headers = securityHeaders(API);

  it('enforces the protections that cannot break a page', () => {
    expect(headers['Strict-Transport-Security']).toBe('max-age=31536000; includeSubDomains');
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['X-Frame-Options']).toBe('DENY');
    expect(headers['Content-Security-Policy']).toContain("frame-ancestors 'none'");
  });

  it('only reports the script and connect policy while it is being tuned', () => {
    expect(headers['Content-Security-Policy']).not.toContain('script-src');
    expect(headers['Content-Security-Policy-Report-Only']).toContain("script-src 'self'");
  });

  it('lets the client-fetch islands reach the API', () => {
    expect(headers['Content-Security-Policy-Report-Only']).toMatch(new RegExp(`connect-src [^;]*${API}`));
  });
});

describe('withSecurityHeaders', () => {
  it('adds the headers and keeps status, body and existing headers', async () => {
    const res = withSecurityHeaders(
      new Response('page', { status: 404, headers: { 'Content-Type': 'text/html' } }),
      { 'X-Content-Type-Options': 'nosniff' },
    );

    expect([res.status, await res.text(), res.headers.get('Content-Type'), res.headers.get('X-Content-Type-Options')])
      .toEqual([404, 'page', 'text/html', 'nosniff']);
  });

  it('works on a redirect, whose headers are immutable', () => {
    const res = withSecurityHeaders(Response.redirect('https://f1.example/drivers', 301), { 'X-Frame-Options': 'DENY' });

    expect([res.status, res.headers.get('Location'), res.headers.get('X-Frame-Options')])
      .toEqual([301, 'https://f1.example/drivers', 'DENY']);
  });
});
