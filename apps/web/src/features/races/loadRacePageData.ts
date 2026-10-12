import { api } from '@/lib/api';
import { unwrapSettled } from '@/lib/utils';
import { gridDrops, type GridDrop } from './gridPenalties';
import { NO_RACE_EVENTS, loadRaceEvents, raceEventTabs, type RaceEventTab, type RaceEvents } from './loadRaceEvents';
import { circuitYearItems, conditionsOf, driverMapOf, fastestLapOf, predictedPodium, winnerOf, type Condition } from './raceView';
import {
  MUTED_TONE, SESSION_BEHAVIOUR, type RacePageKind, type RacePagePrediction, type RacePredictionRow, type StatusBadge,
} from './raceSessionBehaviour';
import type { CircuitHistoryItem, Driver, LapSummary, QualifyingResult, Race, RaceResult } from '@/types';

export type { RacePageKind } from './raceSessionBehaviour';

export interface RacePageTab {
  id: string;
  label: string;
}

export interface RacePageData {
  error: string | null;
  race: Race | null;
  results: RaceResult[];
  qualifying: QualifyingResult[];
  laps: LapSummary[];
  drops: GridDrop[];
  driverMap: Map<number, Driver>;
  events: RaceEvents;
  eventTabs: RaceEventTab[];
  raceYear: number;
  prediction: RacePagePrediction | null;
  podium: RacePredictionRow[];
  confidence: number;
  predCorrect: boolean | null;
  actualWinnerName: string | null;
  isDone: boolean;
  status: StatusBadge;
  sessionDate: string | null;
  countdownTo: string | null;
  conditions: Condition[];
  fastestLap: { code: string; timeStr: string | null } | null;
  yearItems: Array<{ year: number; href: string }>;
  links: Array<{ href: string; label: string }>;
  tabs: RacePageTab[];
  defaultTab: string;
}

const NO_RACE: RacePageData = {
  error: null, race: null, results: [], qualifying: [], laps: [], drops: [], driverMap: new Map(),
  events: NO_RACE_EVENTS, eventTabs: [], raceYear: 0,
  prediction: null, podium: [], confidence: 0, predCorrect: null, actualWinnerName: null, isDone: false,
  status: { icon: 'timer', label: '', toneClass: MUTED_TONE }, sessionDate: null, countdownTo: null,
  conditions: [], fastestLap: null, yearItems: [], links: [], tabs: [], defaultTab: 'circuit',
};

export async function loadRacePageData(kind: RacePageKind, raceId: number, now: Date = new Date()): Promise<RacePageData> {
  const behaviour = SESSION_BEHAVIOUR[kind];
  const [sessionResult, eventsResult] = await Promise.allSettled([
    behaviour.load(raceId),
    loadRaceEvents(raceId, behaviour.session),
  ]);
  if (sessionResult.status === 'rejected') {
    const reason: unknown = sessionResult.reason;
    return { ...NO_RACE, raceYear: now.getFullYear(), error: reason instanceof Error ? reason.message : behaviour.loadError };
  }
  const { race, results, qualifying, laps, prediction } = sessionResult.value;
  const circuitHistory: CircuitHistoryItem[] = await api.getCircuitDetails(race.circuit.circuitKey).then((d) => d.history, () => []);

  const isDone = behaviour.isDone(race);
  const events = unwrapSettled(eventsResult, NO_RACE_EVENTS);
  const raceYear = new Date(race.raceDate).getFullYear();
  const eventTabs = isDone ? raceEventTabs(events, behaviour.radioAlwaysShown(raceYear)) : [];
  const tabs = [
    ...(isDone && results.length > 0 ? [{ id: 'results', label: 'Results' }] : []),
    ...(qualifying.length > 0 ? [{ id: 'qualifying', label: behaviour.qualifyingLabel }] : []),
    ...(isDone && laps.length > 0 ? [{ id: 'laps', label: 'Lap Chart' }] : []),
    ...eventTabs,
    { id: 'circuit', label: 'Circuit' },
  ];
  const podium = predictedPodium(prediction?.drivers ?? []);
  const winner = winnerOf(results);
  return {
    error: null,
    race,
    results,
    qualifying,
    laps,
    drops: gridDrops(results, qualifying),
    driverMap: driverMapOf(results),
    events,
    eventTabs,
    raceYear,
    prediction,
    podium,
    confidence: Math.round(Number(podium[0]?.winProbability ?? 0) * 100),
    predCorrect: prediction && winner ? prediction.predictedWinner.id === winner.driver.id : null,
    actualWinnerName: isDone && winner && winner.driver.id !== prediction?.predictedWinner.id ? winner.driver.fullName : null,
    isDone,
    status: behaviour.status(race, isDone),
    sessionDate: behaviour.sessionDate(race),
    countdownTo: isDone ? null : behaviour.countdownDate(race),
    conditions: conditionsOf(behaviour.conditions(race)),
    fastestLap: fastestLapOf(results, laps),
    yearItems: circuitYearItems(circuitHistory, behaviour.session),
    links: isDone
      ? [
          { href: `/races/${race.id}/race-story${behaviour.analysisQuery.story}`, label: 'Race story' },
          { href: `/races/${race.id}/telemetry${behaviour.analysisQuery.telemetry}`, label: 'Telemetry' },
        ]
      : [],
    tabs,
    defaultTab: tabs[0].id,
  };
}
