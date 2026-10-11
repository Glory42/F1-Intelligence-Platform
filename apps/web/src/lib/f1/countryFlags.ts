export function getCountryFlag(country: string): string {
  const flags: Record<string, string> = {
    'Bahrain': '🇧🇭',
    'Saudi Arabia': '🇸🇦',
    'Australia': '🇦🇺',
    'Japan': '🇯🇵',
    'China': '🇨🇳',
    'USA': '🇺🇸',
    'United States': '🇺🇸',
    'Italy': '🇮🇹',
    'Monaco': '🇲🇨',
    'Canada': '🇨🇦',
    'Spain': '🇪🇸',
    'Austria': '🇦🇹',
    'UK': '🇬🇧',
    'Great Britain': '🇬🇧',
    'Hungary': '🇭🇺',
    'Belgium': '🇧🇪',
    'Netherlands': '🇳🇱',
    'Singapore': '🇸🇬',
    'Azerbaijan': '🇦🇿',
    'Mexico': '🇲🇽',
    'Brazil': '🇧🇷',
    'Qatar': '🇶🇦',
    'UAE': '🇦🇪',
    'Abu Dhabi': '🇦🇪',
    'France': '🇫🇷',
    'Germany': '🇩🇪',
    'Russia': '🇷🇺',
    'Turkey': '🇹🇷',
    'Portugal': '🇵🇹',
    'Malaysia': '🇲🇾',
    'South Korea': '🇰🇷',
    'India': '🇮🇳',
    'South Africa': '🇿🇦',
    'Argentina': '🇦🇷',
    'Switzerland': '🇨🇭',
    'Sweden': '🇸🇪',
    'Morocco': '🇲🇦',
    'Finland': '🇫🇮',
    'Denmark': '🇩🇰',
    'Thailand': '🇹🇭',
    'New Zealand': '🇳🇿',
    'Poland': '🇵🇱',
    'Venezuela': '🇻🇪',
    'Colombia': '🇨🇴',
  };

  return flags[country] || '🏁';
}

export function getCountryName(input: string): string {
  const normalized = input.toUpperCase().trim();
  const map: Record<string, string> = {
    // 3-Letter country codes
    'GBR': 'Great Britain',
    'NED': 'Netherlands',
    'MON': 'Monaco',
    'ESP': 'Spain',
    'GER': 'Germany',
    'FIN': 'Finland',
    'AUS': 'Australia',
    'FRA': 'France',
    'CAN': 'Canada',
    'JPN': 'Japan',
    'MEX': 'Mexico',
    'DEN': 'Denmark',
    'THA': 'Thailand',
    'USA': 'United States',
    'CHN': 'China',
    'BRA': 'Brazil',
    'NZL': 'New Zealand',
    'ARG': 'Argentina',
    'ITA': 'Italy',
    'SUI': 'Switzerland',
    'AUT': 'Austria',
    'POL': 'Poland',
    'SWE': 'Sweden',
    'RUS': 'Russia',
    'VEN': 'Venezuela',
    'BEL': 'Belgium',
    'COL': 'Colombia',
    'IND': 'India',
    'RSA': 'South Africa',
    'POR': 'Portugal',
    'KOR': 'South Korea',
    'MAR': 'Morocco',

    // Demonyms
    'BRITISH': 'Great Britain',
    'DUTCH': 'Netherlands',
    'MONEGASQUE': 'Monaco',
    'SPANISH': 'Spain',
    'GERMAN': 'Germany',
    'FINNISH': 'Finland',
    'AUSTRALIAN': 'Australia',
    'FRENCH': 'France',
    'CANADIAN': 'Canada',
    'JAPANESE': 'Japan',
    'MEXICAN': 'Mexico',
    'DANISH': 'Denmark',
    'THAI': 'Thailand',
    'AMERICAN': 'United States',
    'CHINESE': 'China',
    'BRAZILIAN': 'Brazil',
    'NEW ZEALANDER': 'New Zealand',
    'ARGENTINE': 'Argentina',
    'ARGENTINIAN': 'Argentina',
    'ITALIAN': 'Italy',
    'SWISS': 'Switzerland',
    'AUSTRIAN': 'Austria',
    'POLISH': 'Poland',
    'SWEDISH': 'Sweden',
    'RUSSIAN': 'Russia',
    'VENEZUELAN': 'Venezuela',
    'BELGIAN': 'Belgium',
    'COLOMBIAN': 'Colombia',
    'INDIAN': 'India',
    'SOUTH AFRICAN': 'South Africa',
    'PORTUGUESE': 'Portugal',
    'SOUTH KOREAN': 'South Korea',
    'MOROCCAN': 'Morocco',
  };

  return map[normalized] || input;
}

export function getDriverCountryName(code: string): string {
  const normalized = code.toUpperCase().trim();
  const map: Record<string, string> = {
    'ANT': 'Italy',
    'BEA': 'Great Britain',
    'HAD': 'France',
    'LIN': 'Great Britain',
    'BOR': 'Brazil',
    'LAW': 'New Zealand',
    'COL': 'Argentina', // Franco Colapinto (Argentina)
    'HAM': 'Great Britain',
    'VER': 'Netherlands',
    'LEC': 'Monaco',
    'SAI': 'Spain',
    'RUS': 'Great Britain', // George Russell (Great Britain)
    'PIA': 'Australia',
    'NOR': 'Great Britain',
    'STR': 'Canada',
    'ALO': 'Spain',
    'BOT': 'Finland',
    'ZHO': 'China',
    'HUL': 'Germany',
    'MAG': 'Denmark',
    'TSU': 'Japan',
    'RIC': 'Australia',
    'SAR': 'United States',
    'ALB': 'Thailand',
    'GAS': 'France',
    'OCO': 'France',
    'PER': 'Mexico',
    'MSC': 'Germany',
    'VET': 'Germany',
    'RAI': 'Finland',
    'GIO': 'Italy',
    'MAZ': 'Russia',
    'LAT': 'Canada',
    'KUB': 'Poland',
    'GRO': 'France',
    'FIT': 'Brazil',
    'AIT': 'Great Britain',
    'KVY': 'Russia',
  };
  return map[normalized] || normalized;
}

export function getNationalityFlag(nationality: string): string {
  const country = getCountryName(nationality);
  return getCountryFlag(country);
}

export function getDriverFlagByCode(code: string): string {
  const country = getDriverCountryName(code);
  return getCountryFlag(country);
}

export function getDriverNationalityCode(code: string): string {
  return getDriverCountryName(code);
}
