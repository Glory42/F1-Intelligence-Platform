const TEAM_LOGOS: Record<string, string> = {
  alpine:          '/teams/alpine.svg',
  aston_martin:    '/teams/aston_martin.png',
  audi:            '/teams/audi.png',
  cadillac:        '/teams/cadillac.png',
  ferrari:         '/teams/ferrari.png',
  haas_f1_team:    '/teams/haas_f1_team.svg',
  kick_sauber:     '/teams/kick_sauber.jpg',
  mclaren:         '/teams/mclaren.jpg',
  mercedes:        '/teams/mercedes.png',
  red_bull_racing: '/teams/red_bull_racing.png',
  williams:        '/teams/williams.png',
  rb:              '/teams/rb.png',
  racing_bulls:    '/teams/rb.png',
};

export function getTeamLogo(teamKey: string): string | null {
  return TEAM_LOGOS[teamKey.toLowerCase()] ?? null;
}
