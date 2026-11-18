export const SIDEBAR_COOKIE = 'sidebar';

const COLLAPSED = 'collapsed';
const EXPANDED = 'expanded';
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

// What BaseLayout's head script looks for in document.cookie before first paint.
export const SIDEBAR_COLLAPSED_PAIR = `${SIDEBAR_COOKIE}=${COLLAPSED}`;

// A cookie (not localStorage) so the head script can apply it before first paint: no layout jump.
export function sidebarCookie(collapsed: boolean): string {
  const value = collapsed ? COLLAPSED : EXPANDED;
  return `${SIDEBAR_COOKIE}=${value}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; SameSite=Lax`;
}
