import type { raceControlMessages, raceOvertakes, teamRadioClips } from '../../db/schema';
import type { RaceControlMessage, RaceOvertake, TeamRadioClip } from '../../common/types';

export function toRaceControlMessage(m: typeof raceControlMessages.$inferSelect): RaceControlMessage {
  return {
    id: m.id,
    raceId: m.raceId,
    date: m.date.toISOString(),
    category: m.category,
    flag: m.flag ?? null,
    lapNumber: m.lapNumber ?? null,
    driverNumber: m.driverNumber ?? null,
    scope: m.scope ?? null,
    sector: m.sector ?? null,
    message: m.message,
  };
}

export function toRaceOvertake(o: typeof raceOvertakes.$inferSelect): RaceOvertake {
  return {
    id: o.id,
    raceId: o.raceId,
    date: o.date.toISOString(),
    overtakingDriverId: o.overtakingDriverId,
    overtakenDriverId: o.overtakenDriverId,
    position: o.position,
  };
}

export function toTeamRadioClip(c: typeof teamRadioClips.$inferSelect): TeamRadioClip {
  return {
    id: c.id,
    raceId: c.raceId,
    driverId: c.driverId,
    date: c.date.toISOString(),
    recordingUrl: c.recordingUrl,
  };
}
