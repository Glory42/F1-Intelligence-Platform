// Same rule as compute_season_stats.py (docs/adr/0002): DSQ and DNS count as non-finishes.
export function isClassifiedFinish(status: string | null): boolean {
  return status != null && (status === 'Finished' || status === 'Lapped' || /^\+\d+ Laps?$/.test(status));
}
