const TEAM_COLORS: Record<string, string> = {
  // Current teams: keys match DB team_key (full name lowercased + underscores)
  red_bull_racing: '#3671C6',
  mercedes:        '#27F4D2',
  ferrari:         '#E8002D',
  mclaren:         '#FF8000',
  aston_martin:    '#229971',
  alpine:          '#FF87BC',
  williams:        '#64C4FF',
  rb:              '#6692FF',
  racing_bulls:    '#6692FF',
  kick_sauber:     '#52E252',
  haas_f1_team:    '#B6BABD',
  audi:            '#BB0021',
  cadillac:        '#003DA5',

  // Red Bull: short key used in pre-2018 DB rows
  red_bull:          '#3671C6',

  // Historical: full name variants
  renault:           '#FFD800',
  lotus_f1:          '#FFB800',
  lotus:             '#FFB800',
  force_india:       '#FF80C7',
  racing_point:      '#F596C8',
  toro_rosso:        '#469BFF',
  alphatauri:        '#5433FF',
  alpha_tauri:       '#5433FF',
  alfa_romeo:        '#C92D4B',
  alfa_romeo_racing: '#C92D4B',
  sauber:            '#9B0000',
  bmw_sauber:        '#1C84CE',
  manor:             '#FF2C2C',
  marussia:          '#6E0000',
  hrt:               '#BE8300',
  virgin:            '#CC0000',
  brawn:             '#CCFF00',
  honda:             '#CC0000',
  bar:               '#FFFFFF',
  toyota:            '#CC1200',
  jaguar:            '#006400',
  minardi:           '#191919',
  jordan:            '#FFD700',
  benetton:          '#00A651',
  arrows:            '#FF6B00',
  prost:             '#0061A1',
  stewart:           '#FFFFFF',
  caterham:          '#006400',
  manor_marussia:    '#FF2C2C',
  spyker:            '#FF6600',
  super_aguri:       '#CC0000',
  mf1:               '#E8002D',
};

const FALLBACK_COLOR = '#6B7280';

export function getTeamColor(teamKey: string): string {
  return TEAM_COLORS[teamKey.toLowerCase()] ?? FALLBACK_COLOR;
}

const MIN_TEXT_CONTRAST = 4.5;

function relativeLuminance([r, g, b]: number[]): number {
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r / 255) + 0.7152 * lin(g / 255) + 0.0722 * lin(b / 255);
}

// Text in a team colour must still read on the black page (WCAG AA, 4.5:1): mix it towards white
// only as far as needed, so bright team colours stay exactly as they are.
export function readableOnBlack(hex: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  for (let white = 0; white <= 1; white += 0.05) {
    const mixed = rgb.map((c) => Math.round(c + (255 - c) * white));
    if ((relativeLuminance(mixed) + 0.05) / 0.05 >= MIN_TEXT_CONTRAST) {
      return white === 0 ? hex : `#${mixed.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
    }
  }
  return '#ffffff';
}
