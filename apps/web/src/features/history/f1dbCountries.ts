// F1DB identifies countries by kebab-case id ('united-kingdom'); flags are built from ISO 3166 codes.
const ISO_CODES: Record<string, string> = {
  'argentina': 'AR', 'australia': 'AU', 'austria': 'AT', 'azerbaijan': 'AZ', 'bahrain': 'BH', 'belgium': 'BE',
  'brazil': 'BR', 'canada': 'CA', 'chile': 'CL', 'china': 'CN', 'colombia': 'CO', 'czech-republic': 'CZ',
  'denmark': 'DK', 'east-germany': 'DE', 'finland': 'FI', 'france': 'FR', 'germany': 'DE', 'hong-kong': 'HK',
  'hungary': 'HU', 'india': 'IN', 'indonesia': 'ID', 'ireland': 'IE', 'israel': 'IL', 'italy': 'IT', 'japan': 'JP',
  'liechtenstein': 'LI', 'luxembourg': 'LU', 'malaysia': 'MY', 'mexico': 'MX', 'monaco': 'MC', 'morocco': 'MA',
  'netherlands': 'NL', 'new-zealand': 'NZ', 'poland': 'PL', 'portugal': 'PT', 'qatar': 'QA', 'russia': 'RU',
  'saudi-arabia': 'SA', 'singapore': 'SG', 'south-africa': 'ZA', 'south-korea': 'KR', 'spain': 'ES', 'sweden': 'SE',
  'switzerland': 'CH', 'thailand': 'TH', 'turkey': 'TR', 'united-arab-emirates': 'AE', 'united-kingdom': 'GB',
  'united-states-of-america': 'US', 'uruguay': 'UY', 'venezuela': 'VE', 'west-germany': 'DE',
};

const NAME_OVERRIDES: Record<string, string> = {
  'united-states-of-america': 'United States',
};

export function f1dbCountryFlag(countryId: string | null): string {
  const iso = countryId ? ISO_CODES[countryId] : undefined;
  if (!iso) return '🏁';
  return String.fromCodePoint(...[...iso].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

export function f1dbCountryName(countryId: string | null): string {
  if (!countryId) return 'Unknown';
  return NAME_OVERRIDES[countryId]
    ?? countryId.split('-').map((w) => (w === 'of' ? w : w[0].toUpperCase() + w.slice(1))).join(' ');
}
