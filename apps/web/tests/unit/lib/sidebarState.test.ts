import { describe, expect, it } from 'vitest';
import { SIDEBAR_COOKIE, isSidebarCollapsed, sidebarCookie } from '@/lib/sidebarState';

describe('sidebar collapse state', () => {
  it('reads a collapsed sidebar back from the cookie it writes', () => {
    const [pair] = sidebarCookie(true).split(';');
    const [name, value] = pair.split('=');

    expect(name).toBe(SIDEBAR_COOKIE);
    expect(isSidebarCollapsed(value)).toBe(true);
  });

  it('reads an expanded sidebar back from the cookie it writes', () => {
    const value = sidebarCookie(false).split(';')[0].split('=')[1];

    expect(isSidebarCollapsed(value)).toBe(false);
  });

  it('starts expanded when there is no cookie or it holds anything unexpected', () => {
    expect(isSidebarCollapsed(undefined)).toBe(false);
    expect(isSidebarCollapsed('')).toBe(false);
    expect(isSidebarCollapsed('yes please')).toBe(false);
  });

  it('remembers the choice site-wide for a year', () => {
    const cookie = sidebarCookie(true);

    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('Max-Age=31536000');
    expect(cookie).toContain('SameSite=Lax');
  });
});
