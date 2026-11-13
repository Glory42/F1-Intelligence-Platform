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
