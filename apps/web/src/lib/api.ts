import type {
  PredictionResponse, RaceDetailResponse, DriverDetailResponse, TeamDetailResponse,
  Race, Driver, Team, DriverStanding, TeamStanding, Circuit,
  PredictionHistoryItem, IntelStandingRow, CircuitDetailResponse, RaceControlMessage, RaceOvertake, TeamRadioClip,
  DriverYearStats, TeamYearStats, SeasonSummary,
  SprintPredictionResponse, SprintDetailResponse, ModelInfo, SeasonAccuracy,
  QualityReport, RaceSession, StrategyResponse, PitCrewRanking, FridayPaceRow,
  TitleOddsResponse, TeammateBattle, RacecraftRow, RaceStoryResponse, TelemetryResponse, QualifyingSession,
  HistoryRecords, DriverHistory, TeamHistory, RaceRecap, OnThisDayRace,
} from '@/types';

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:8787';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`);
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  const json = (await res.json()) as { data: T; error: null } | { data: null; error: { message: string } };
  if (json.error) throw new Error(json.error.message);
  return json.data;
}

// Omitted for the GP so existing URLs (and their edge-cache entries) stay unchanged.
function sessionQuery(session: RaceSession): string {
  return session === 'race' ? '' : `?session=${session}`;
}

export const api = {
  // Predictions
  getModelInfo: () => get<ModelInfo>('/api/predictions/model-info'),
  getUpcomingPrediction: () => get<PredictionResponse>('/api/predictions/upcoming'),
  getPredictionByRace: (raceId: number) => get<PredictionResponse>(`/api/predictions/race/${raceId}`),
  getPredictionHistory: (year: number) => get<PredictionHistoryItem[]>(`/api/predictions/history?year=${year}`),
  getPredictionAccuracy: () => get<SeasonAccuracy[]>('/api/predictions/accuracy'),
  getIntelStandings: (year: number) => get<IntelStandingRow[]>(`/api/predictions/standings?year=${year}`),

  // Races
  getRaces: (year: number, status?: string) => {
    const q = status ? `?year=${year}&status=${status}` : `?year=${year}`;
    return get<Race[]>(`/api/races${q}`);
  },
  getRaceById: (id: number) => get<RaceDetailResponse>(`/api/races/${id}`),
  getRaceControlMessages: (raceId: number, session: RaceSession = 'race') =>
    get<RaceControlMessage[]>(`/api/races/${raceId}/race-control${sessionQuery(session)}`),
  getOvertakes: (raceId: number, session: RaceSession = 'race') =>
    get<RaceOvertake[]>(`/api/races/${raceId}/overtakes${sessionQuery(session)}`),
  getTeamRadio: (raceId: number, session: RaceSession = 'race') =>
    get<TeamRadioClip[]>(`/api/races/${raceId}/team-radio${sessionQuery(session)}`),
  getRaceStory: (raceId: number, session: RaceSession = 'race') =>
    get<RaceStoryResponse>(`/api/races/${raceId}/race-story${sessionQuery(session)}`),
  getTelemetry: (raceId: number, session: QualifyingSession, a?: string, b?: string) => {
    const params = new URLSearchParams({ session });
    if (a) params.set('a', a);
    if (b) params.set('b', b);
    return get<TelemetryResponse>(`/api/races/${raceId}/telemetry?${params}`);
  },
  getStrategy: (raceId: number, session: RaceSession = 'race') =>
    get<StrategyResponse>(`/api/races/${raceId}/strategy${sessionQuery(session)}`),
  getPitCrewRankings: (year: number) => get<PitCrewRanking[]>(`/api/teams/pit-stops?year=${year}`),
  getFridayPace: (raceId: number) => get<FridayPaceRow[]>(`/api/predictions/race/${raceId}/friday-pace`),
  getTitleOdds: (year: number) => get<TitleOddsResponse>(`/api/predictions/title-odds?year=${year}`),
  getTeammateBattle: (driverId: number, year: number) =>
    get<TeammateBattle>(`/api/drivers/${driverId}/teammate-battle?year=${year}`),
  getRacecraft: (year: number) => get<RacecraftRow[]>(`/api/drivers/racecraft?year=${year}`),
  getHistoryRecords: () => get<HistoryRecords>('/api/history/records'),
  getOnThisDay: (monthDay: string) => get<OnThisDayRace[]>(`/api/history/on-this-day?date=${monthDay}`),
  getRaceRecap: (raceId: number) => get<RaceRecap>(`/api/races/${raceId}/recap`),
  getDriverHistory: (driverId: number) => get<DriverHistory>(`/api/drivers/${driverId}/history`),
  getTeamHistory: (teamId: number) => get<TeamHistory>(`/api/teams/${teamId}/history`),
  getCircuitDetails: (circuitKey: string) => get<CircuitDetailResponse>(`/api/races/circuit/${circuitKey}`),
  getCircuits: () => get<Circuit[]>('/api/races/circuits'),

  // Drivers
  getDrivers: (year: number) => get<Driver[]>(`/api/drivers?year=${year}`),
  getDriverStandings: (year: number) => get<DriverStanding[]>(`/api/drivers/standings?year=${year}`),
  getDriverById: (id: number, year: number) => get<DriverDetailResponse>(`/api/drivers/${id}?year=${year}`),
  getDriverCareer: (id: number) => get<DriverYearStats[]>(`/api/drivers/${id}/career`),

  // Sprint
  getSprintUpcoming: () => get<SprintPredictionResponse>('/api/sprint/upcoming'),
  getSprintByRaceId: (raceId: number) => get<SprintPredictionResponse>(`/api/sprint/race/${raceId}`),
  getSprintDetail: (raceId: number) => get<SprintDetailResponse>(`/api/sprint/race/${raceId}/detail`),

  // Seasons
  getSeasons: () => get<SeasonSummary[]>('/api/seasons'),

  // Search
  getGlobalSearch: () => get<{ drivers: Driver[]; teams: Team[]; circuits: Circuit[] }>('/api/search'),

  // Teams
  getTeams: (year: number) => get<Team[]>(`/api/teams?year=${year}`),
  getTeamStandings: (year: number) => get<TeamStanding[]>(`/api/teams/standings?year=${year}`),
  getTeamById: (id: number, year: number) => get<TeamDetailResponse>(`/api/teams/${id}?year=${year}`),
  getTeamCareer: (id: number) => get<TeamYearStats[]>(`/api/teams/${id}/career`),

  // Quality (dev-only — see lib/api dev guard)
  getQuality: (year: number) => get<QualityReport>(`/api/quality?year=${year}`),
};
