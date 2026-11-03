import { describe, expect, it } from 'vitest';
import { canonicalHostRedirect } from '@/lib/canonicalHost';

const site = new URL('https://f1.gorkemkaryol.dev');

describe('canonicalHostRedirect', () => {
  it('sends the production pages.dev address to the custom domain, keeping path and query', () => {
    const url = new URL('https://f1-site.pages.dev/drivers/12?tab=career');

    expect(canonicalHostRedirect(url, site)).toBe('https://f1.gorkemkaryol.dev/drivers/12?tab=career');
  });

  it('leaves preview and branch deployments reachable', () => {
    expect(canonicalHostRedirect(new URL('https://3f2a91c.f1-site.pages.dev/'), site)).toBeNull();
    expect(canonicalHostRedirect(new URL('https://feat-x.f1-site.pages.dev/races'), site)).toBeNull();
  });

  it('leaves the custom domain and local dev alone', () => {
    expect(canonicalHostRedirect(new URL('https://f1.gorkemkaryol.dev/races'), site)).toBeNull();
    expect(canonicalHostRedirect(new URL('http://localhost:4321/races'), site)).toBeNull();
  });

  it('does nothing when no site is configured', () => {
    expect(canonicalHostRedirect(new URL('https://f1-site.pages.dev/'), undefined)).toBeNull();
  });
});
