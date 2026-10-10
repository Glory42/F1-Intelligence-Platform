// Mirrors data-engine's f1db.normalize_person_name — the join key between core drivers and
// history_drivers.match_key. Change both together.
export function normalizePersonName(name: string): string {
  const ascii = name.normalize('NFKD').replace(/[̀-ͯ]/g, '');
  return ascii.toLowerCase().split(/\s+/).filter(Boolean).join(' ').replace(/\s+(jr|sr|ii|iii)\.?$/, '');
}

// Core team keys come from the Ergast/Jolpica constructor ids; F1DB uses hyphens and, for a few
// entries, a different name for the same constructor.
const CONSTRUCTOR_ALIASES: Record<string, string> = {
  red_bull_racing: 'red-bull',
  haas_f1_team: 'haas',
  alfa_romeo_racing: 'alfa-romeo',
  manor_marussia: 'manor',
};

export function f1dbConstructorId(teamKey: string): string {
  return CONSTRUCTOR_ALIASES[teamKey] ?? teamKey.replace(/_/g, '-');
}
