export interface YearLink {
  year: number;
  href: string;
}

// Driver and team pages open the requested season if they raced in it, else this season, else their last one.
export function resolveCareerYear(activeYears: number[], requested: number | null, currentYear: number): number | null {
  if (activeYears.length === 0) return null;
  if (requested != null && activeYears.includes(requested)) return requested;
  if (activeYears.includes(currentYear)) return currentYear;
  return Math.max(...activeYears);
}
