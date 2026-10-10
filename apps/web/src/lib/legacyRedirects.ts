// The per-season prediction recap pages were merged into the Predictions Scorecard tab.
export function legacyRedirect(pathname: string): string | null {
  const path = pathname.replace(/\/+$/, '');
  if (path === '/prediction/recap') return '/prediction?tab=scorecard';
  const season = path.match(/^\/prediction\/recap\/(\d{4})$/);
  return season ? `/prediction?tab=scorecard&year=${season[1]}` : null;
}
