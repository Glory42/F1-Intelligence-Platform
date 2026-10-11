export type TyreToken = 'tyre-soft' | 'tyre-medium' | 'tyre-hard' | 'tyre-inter' | 'tyre-wet' | 'tyre-unknown';

const TOKENS: Record<string, TyreToken> = {
  SOFT: 'tyre-soft',
  MEDIUM: 'tyre-medium',
  HARD: 'tyre-hard',
  INTERMEDIATE: 'tyre-inter',
  WET: 'tyre-wet',
};

export function compoundToken(compound: string | null | undefined): TyreToken {
  return (compound && TOKENS[compound.toUpperCase()]) || 'tyre-unknown';
}
