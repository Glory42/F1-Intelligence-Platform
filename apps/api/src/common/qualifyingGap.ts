export interface QualifyingTimes {
  q1TimeMs: number | null;
  q2TimeMs: number | null;
  q3TimeMs: number | null;
}

const SESSIONS = ['q3TimeMs', 'q2TimeMs', 'q1TimeMs'] as const;

// The deepest session both reached is the fairest like-for-like lap; negative means `a` was faster.
export function qualifyingGapMs(a: QualifyingTimes, b: QualifyingTimes): number | null {
  for (const session of SESSIONS) {
    const mine = a[session];
    const theirs = b[session];
    if (mine != null && theirs != null) return mine - theirs;
  }
  return null;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
