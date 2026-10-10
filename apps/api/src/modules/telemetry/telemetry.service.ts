import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../../config/database';
import { drivers, qualifyingLapTelemetry, teams } from '../../db/schema';
import type { QualifyingSession, TelemetryResponse } from '../../common/types';
import { toDriver } from '../../common/mappers';

export class TelemetryService {
  // Two passes keep the payload small: a cheap list of who has a lap, then samples for two only.
  async findComparison(
    db: Db, raceId: number, session: QualifyingSession, codes: [string | undefined, string | undefined],
  ): Promise<TelemetryResponse> {
    const listRows = await db
      .select({ driver: drivers, team: teams, lapTimeMs: qualifyingLapTelemetry.lapTimeMs })
      .from(qualifyingLapTelemetry)
      .innerJoin(drivers, eq(qualifyingLapTelemetry.driverId, drivers.id))
      .innerJoin(teams, eq(drivers.teamId, teams.id))
      .where(and(eq(qualifyingLapTelemetry.raceId, raceId), eq(qualifyingLapTelemetry.sessionType, session)))
      .orderBy(asc(qualifyingLapTelemetry.lapTimeMs));

    const available = listRows.map((r) => ({ driver: toDriver(r.driver, r.team), lapTimeMs: r.lapTimeMs }));
    const pick = (code: string | undefined, fallback: number) =>
      available.find((d) => d.driver.code === code?.toUpperCase()) ?? available[fallback];
    const chosen = [pick(codes[0], 0), pick(codes[1], 1)].filter((d) => d != null);

    const laps = await Promise.all(
      chosen.map(async (c) => {
        const [row] = await db
          .select({ lapNumber: qualifyingLapTelemetry.lapNumber, samples: qualifyingLapTelemetry.samples })
          .from(qualifyingLapTelemetry)
          .where(and(
            eq(qualifyingLapTelemetry.raceId, raceId),
            eq(qualifyingLapTelemetry.sessionType, session),
            eq(qualifyingLapTelemetry.driverId, c.driver.id),
          ));
        return { driver: c.driver, lapNumber: row.lapNumber, lapTimeMs: c.lapTimeMs, samples: row.samples };
      }),
    );
    return { session, drivers: available, laps };
  }
}
