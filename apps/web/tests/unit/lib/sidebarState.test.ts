import { describe, expect, it } from 'vitest';
import { SIDEBAR_COLLAPSED_PAIR, sidebarCookie } from '@/lib/sidebarState';

const pairOf = (cookie: string) => cookie.split(';')[0];

describe('sidebar collapse state', () => {
  it('writes the pair the layout reads back as collapsed', () => {
    expect(pairOf(sidebarCookie(true))).toBe(SIDEBAR_COLLAPSED_PAIR);
  });

  it('writes something else for an expanded sidebar', () => {
    expect(pairOf(sidebarCookie(false))).not.toBe(SIDEBAR_COLLAPSED_PAIR);
  });

  it('remembers the choice site-wide for a year', () => {
    const cookie = sidebarCookie(true);

    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('Max-Age=31536000');
    expect(cookie).toContain('SameSite=Lax');
  });
});
