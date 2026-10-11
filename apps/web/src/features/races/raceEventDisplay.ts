import { getTeamColor } from '@/lib/f1/teamColors';
import type { Driver } from '@/types';

// Mapper output is always a UTC ISO string (e.g. "2024-11-03T15:31:01.000Z") — slicing
// avoids a timezone-dependent Date parse just to show the session clock time.
export function timeOf(iso: string): string {
  return iso.slice(11, 19);
}

export function dotColor(driver: Driver | undefined): string {
  return driver ? getTeamColor(driver.team.teamKey) : '#6B7280';
}
