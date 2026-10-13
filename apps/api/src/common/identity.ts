// Who is the same person, and which team rows are the same outfit, across season-scoped rows and
// F1DB. Golden cases: docs/identity-cases.json (also read by data-engine's normalize_person_name test).

export interface DriverName {
  code: string;
  firstName: string;
  lastName: string;
}

function asciiWords(name: string): string {
  const ascii = name.normalize('NFKD').replace(/[̀-ͯ]/g, '');
  return ascii.toLowerCase().split(/\s+/).filter(Boolean).join(' ');
}

// One person per first + last name (ADR-0009). Keeps "Jr.", so Piquet Sr. and Jr. stay two people.
export function personKey(d: Pick<DriverName, 'firstName' | 'lastName'>): string {
  return asciiWords(`${d.firstName} ${d.lastName}`);
}

// FastF1's names vary by season ("Andrea Kimi Antonelli" in 2025 only): a matching code lets one
// name extend the other. Codes alone are labels, not keys (Bernard and Berger are both BER in 1990).
export function isSamePerson(a: DriverName, b: DriverName): boolean {
  const ka = personKey(a);
  const kb = personKey(b);
  if (ka === kb) return true;
  return a.code === b.code && (ka.endsWith(` ${kb}`) || kb.endsWith(` ${ka}`));
}

// history_drivers.match_key: F1DB writes "Carlos Sainz Jr." where core data has "Carlos Sainz".
// Mirrors data-engine's f1db.normalize_person_name: change both together.
export function f1dbPersonKey(fullName: string): string {
  return asciiWords(fullName).replace(/\s+(jr|sr|ii|iii)\.?$/, '');
}

// Each outfit's team keys in order, its current one last. Team keys come from the team name
// (driver_registry.team_key_for), so a rebrand or a respelling starts a new key.
const LINEAGES: string[][] = [
  ['minardi', 'toro_rosso', 'alphatauri', 'alpha_tauri', 'rb', 'racing_bulls'],
  ['stewart', 'jaguar', 'red_bull', 'red_bull_racing'],
  ['jordan', 'midland', 'mf1', 'spyker', 'force_india', 'racing_point', 'aston_martin'],
  ['sauber', 'bmw_sauber', 'alfa_romeo_racing', 'alfa_romeo', 'kick_sauber', 'audi'],
  ['toleman', 'benetton', 'renault', 'lotus_f1', 'alpine'],
  ['bar', 'honda', 'brawn', 'mercedes'],
  ['virgin', 'marussia', 'manor_marussia', 'manor'],
  ['haas', 'haas_f1_team'],
];

const CONSTRUCTOR_KEY = new Map(LINEAGES.flatMap((keys) => keys.map((k) => [k, keys[keys.length - 1]] as const)));

// One outfit across its rebrands (Toro Rosso -> AlphaTauri -> RB), kept apart from its sister team.
export function constructorKey(teamKey: string): string {
  return CONSTRUCTOR_KEY.get(teamKey) ?? teamKey;
}

// Every team key that belongs to the same outfit as `teamKey`, for a single IN (...) query.
export function constructorTeamKeys(teamKey: string): string[] {
  return LINEAGES.find((keys) => keys.includes(teamKey)) ?? [teamKey];
}

// F1DB constructors are per brand (its lineage table links them), so this maps a key to its own
// brand: F1DB uses hyphens and, for a few entries, a different name.
const F1DB_CONSTRUCTOR_ALIASES: Record<string, string> = {
  red_bull_racing: 'red-bull',
  alpha_tauri: 'alphatauri',
  haas_f1_team: 'haas',
  alfa_romeo_racing: 'alfa-romeo',
  manor_marussia: 'manor',
  team_lotus: 'lotus',
  mf1: 'midland',
  lambo: 'modena',
  euro_brun: 'eurobrun',
};

export function f1dbConstructorId(teamKey: string): string {
  return F1DB_CONSTRUCTOR_ALIASES[teamKey] ?? teamKey.replace(/_/g, '-');
}
