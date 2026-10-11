import { api } from '@/lib/api';
import { unwrapSettled } from '@/lib/utils';
import type { RaceControlMessage, RaceOvertake, RaceSession, StrategyResponse, TeamRadioClip } from '@/types';

export type RaceEvents = {
  raceControlMessages: RaceControlMessage[];
  overtakes: RaceOvertake[];
  teamRadio: TeamRadioClip[];
  strategy: StrategyResponse | null;
};

export const NO_RACE_EVENTS: RaceEvents = { raceControlMessages: [], overtakes: [], teamRadio: [], strategy: null };

// Each feed degrades on its own: a missing one just hides its tab.
export async function loadRaceEvents(raceId: number, session: RaceSession): Promise<RaceEvents> {
  const [raceControl, overtakes, teamRadio, strategy] = await Promise.allSettled([
    api.getRaceControlMessages(raceId, session),
    api.getOvertakes(raceId, session),
    api.getTeamRadio(raceId, session),
    api.getStrategy(raceId, session),
  ]);
  return {
    raceControlMessages: unwrapSettled(raceControl, []),
    overtakes: unwrapSettled(overtakes, []),
    teamRadio: unwrapSettled(teamRadio, []),
    strategy: unwrapSettled(strategy, null),
  };
}

export function hasStrategyData(strategy: StrategyResponse | null): boolean {
  return (strategy?.drivers ?? []).some((d) => d.stints.length > 0);
}

export type RaceEventTab = { id: 'strategy' | 'incidents' | 'overtakes' | 'team-radio'; label: string };

// radioAlwaysShown keeps the tab (with an explanation) for seasons where F1 publishes few clips.
export function raceEventTabs(events: RaceEvents, radioAlwaysShown = false): RaceEventTab[] {
  const tabs: Array<RaceEventTab & { hasData: boolean }> = [
    { id: 'strategy', label: 'Strategy', hasData: hasStrategyData(events.strategy) },
    { id: 'incidents', label: 'Incidents', hasData: events.raceControlMessages.length > 0 },
    { id: 'overtakes', label: 'Overtakes', hasData: events.overtakes.length > 0 },
    { id: 'team-radio', label: 'Team Radio', hasData: events.teamRadio.length > 0 || radioAlwaysShown },
  ];
  return tabs.filter((t) => t.hasData).map(({ id, label }) => ({ id, label }));
}
