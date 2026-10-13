import { api } from '@/lib/api';
import { unwrapSettled } from '@/lib/utils';
import { sprintQualifyingGrid, type SessionConditions } from './raceView';
import type { Driver, LapSummary, QualifyingResult, Race, RaceResult, RaceSession } from '@/types';

export type RacePageKind = 'gp' | 'sprint';

export interface StatusBadge {
  icon: 'check' | 'zap' | 'timer';
  label: string;
  toneClass: string;
}

export interface RacePredictionRow {
  driver: Driver;
  winProbability: string;
  predictedPosition: number | null;
}

export interface RacePagePrediction {
  predictedWinner: Driver;
  drivers: RacePredictionRow[];
}

export interface SessionData {
  race: Race;
  results: RaceResult[];
  qualifying: QualifyingResult[];
  laps: LapSummary[];
  prediction: RacePagePrediction | null;
}

// Everything that differs between a grand prix page and its sprint page; the rest of the loader is shared.
export interface SessionBehaviour {
  session: RaceSession;
  load: (raceId: number) => Promise<SessionData>;
  isDone: (race: Race) => boolean;
  status: (race: Race, isDone: boolean) => StatusBadge;
  sessionDate: (race: Race) => string;
  countdownDate: (race: Race) => string;
  conditions: (race: Race) => SessionConditions;
  qualifyingLabel: string;
  radioAlwaysShown: (raceYear: number) => boolean;
  analysisQuery: { story: string; telemetry: string };
  loadError: string;
}

export const MUTED_TONE = 'border-white/[0.08] text-muted-foreground';
// OpenF1 notes F1 releases far fewer radio clips from 2026 on, so an empty list there is expected.
const RADIO_SPARSE_FROM_YEAR = 2026;

function gpStatus(race: Race): StatusBadge {
  const label = race.status.replace(/_/g, ' ');
  switch (race.status) {
    case 'completed':
      return { icon: 'check', label, toneClass: 'border-[rgba(168,85,247,0.3)] text-[rgba(168,85,247,0.7)]' };
    case 'qualifying_done':
      return { icon: 'zap', label, toneClass: 'border-yellow-500/30 text-yellow-400/70' };
    case 'sprint_done':
    case 'sprint_qualifying_done':
      return { icon: 'zap', label, toneClass: 'border-orange-500/30 text-orange-400/70' };
    default:
      return { icon: 'timer', label, toneClass: MUTED_TONE };
  }
}

async function loadGrandPrix(raceId: number): Promise<SessionData> {
  const [detail, prediction] = await Promise.allSettled([api.getRaceById(raceId), api.getPredictionByRace(raceId)]);
  if (detail.status === 'rejected') throw detail.reason;
  return { ...detail.value, prediction: unwrapSettled(prediction, null) };
}

// Sprint qualifying is stored on the sprint rows, so grid-only rows feed the SQ grid but not the result.
async function loadSprint(raceId: number): Promise<SessionData> {
  const { race, prediction, results, laps } = await api.getSprintDetail(raceId);
  return {
    race,
    prediction,
    laps,
    results: results.filter((r) => r.status !== 'grid_set'),
    qualifying: sprintQualifyingGrid(results),
  };
}

const SPRINT_DONE_STATUSES: ReadonlySet<Race['status']> = new Set(['sprint_done', 'qualifying_done', 'completed']);

export const SESSION_BEHAVIOUR: Record<RacePageKind, SessionBehaviour> = {
  gp: {
    session: 'race',
    load: loadGrandPrix,
    isDone: (race) => race.status === 'completed',
    status: gpStatus,
    sessionDate: (race) => race.raceDate,
    countdownDate: (race) => race.raceDateUtc || race.raceDate,
    conditions: (race) => race,
    qualifyingLabel: 'Qualifying',
    radioAlwaysShown: (raceYear) => raceYear >= RADIO_SPARSE_FROM_YEAR,
    analysisQuery: { story: '', telemetry: '' },
    loadError: 'Failed to load race',
  },
  sprint: {
    session: 'sprint',
    load: loadSprint,
    isDone: (race) => SPRINT_DONE_STATUSES.has(race.status),
    status: (_race, isDone) => isDone
      ? { icon: 'check', label: 'sprint done', toneClass: 'border-orange-500/30 text-orange-400/70' }
      : { icon: 'timer', label: 'sprint upcoming', toneClass: MUTED_TONE },
    sessionDate: (race) => race.sprintDate ?? race.raceDate,
    countdownDate: (race) => race.sprintDate ?? race.raceDate,
    conditions: (race) => ({
      safetyCarLaps: race.sprintSafetyCarLaps, vscLaps: race.sprintVscLaps, airTempAvg: race.sprintAirTempAvg,
      trackTempAvg: race.sprintTrackTempAvg, humidityAvg: race.sprintHumidityAvg,
    }),
    qualifyingLabel: 'Sprint Quali',
    radioAlwaysShown: () => false,
    analysisQuery: { story: '?session=sprint', telemetry: '?session=SQ' },
    loadError: 'Failed to load sprint data',
  },
};
