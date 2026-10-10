export const SIDEBAR_COOKIE = 'sidebar';

const COLLAPSED = 'collapsed';
const EXPANDED = 'expanded';
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export function isSidebarCollapsed(cookieValue: string | undefined): boolean {
  return cookieValue === COLLAPSED;
}

// A cookie (not localStorage) so the server renders the right width and the layout never jumps.
export function sidebarCookie(collapsed: boolean): string {
  const value = collapsed ? COLLAPSED : EXPANDED;
  return `${SIDEBAR_COOKIE}=${value}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; SameSite=Lax`;
}
