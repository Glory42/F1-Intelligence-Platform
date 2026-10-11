export type TyreToken =
  | 'tyre-soft' | 'tyre-medium' | 'tyre-hard' | 'tyre-inter' | 'tyre-wet' | 'tyre-unknown'
  | 'tyre-hypersoft' | 'tyre-ultrasoft' | 'tyre-icehard' | 'tyre-superhard';

const TOKENS: Record<string, TyreToken> = {
  SOFT: 'tyre-soft',
  MEDIUM: 'tyre-medium',
  HARD: 'tyre-hard',
  INTERMEDIATE: 'tyre-inter',
  WET: 'tyre-wet',
};

// 2018 used Pirelli's seven named compounds and colours (soft was yellow, medium white); from
// 2019 the timing feed reports each race's three as soft/medium/hard.
const LAST_NAMED_COMPOUND_SEASON = 2018;
const NAMED_TOKENS: Record<string, TyreToken> = {
  HYPERSOFT: 'tyre-hypersoft',
  ULTRASOFT: 'tyre-ultrasoft',
  SUPERSOFT: 'tyre-soft',
  SOFT: 'tyre-medium',
  MEDIUM: 'tyre-hard',
  HARD: 'tyre-icehard',
  SUPERHARD: 'tyre-superhard',
};

export function compoundToken(compound: string | null | undefined, year?: number): TyreToken {
  if (!compound) return 'tyre-unknown';
  const key = compound.toUpperCase();
  const named = year != null && year <= LAST_NAMED_COMPOUND_SEASON ? NAMED_TOKENS[key] : undefined;
  return named ?? TOKENS[key] ?? 'tyre-unknown';
}
