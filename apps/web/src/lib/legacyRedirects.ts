// Pages that moved keep their query string (picked drivers, open tab).
const MOVED: Record<string, string> = {
  '/drivers/compare': '/compare/drivers',
  '/teams/compare': '/compare/teams',
  '/compare': '/compare/drivers',
  '/records': '/history',
};

// The per-season prediction recap pages were merged into the Predictions Scorecard tab.
export function legacyRedirect(pathname: string, search = ''): string | null {
  const path = pathname.replace(/\/+$/, '');
  if (MOVED[path]) return MOVED[path] + search;
  if (path === '/prediction/recap') return '/prediction?tab=scorecard';
  const season = path.match(/^\/prediction\/recap\/(\d{4})$/);
  return season ? `/prediction?tab=scorecard&year=${season[1]}` : null;
}
