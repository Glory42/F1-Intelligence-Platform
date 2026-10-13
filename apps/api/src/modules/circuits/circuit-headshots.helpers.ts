import { eq, desc, inArray, or } from 'drizzle-orm';
import type { Db } from '../../config/database';
import { drivers, teams, seasons } from '../../db/schema';
import { personKey } from '../../common/identity';
import { ERAS, type EraMap, type DriverWinEntry } from './circuit-era.helpers';

// Historical rows often lack headshots: read-only enrichment from each driver's
// latest season profile, swapped into the per-era win entries in place.
export async function backfillDriverHeadshots(
  db: Db,
  driverWinsByEra: EraMap<Map<string, DriverWinEntry>>
): Promise<void> {
  const winners = Array.from(driverWinsByEra.all.values()).map((entry) => entry.driver);
  if (winners.length === 0) return;

  // Code or surname only narrows the candidates; personKey decides, since a later season may
  // spell the name differently (accents) or reuse the code for someone else.
  const latestProfiles = await db
    .select({ driver: drivers, team: teams, year: seasons.year })
    .from(drivers)
    .innerJoin(teams, eq(drivers.teamId, teams.id))
    .innerJoin(seasons, eq(drivers.seasonId, seasons.id))
    .where(or(
      inArray(drivers.code, winners.map((d) => d.code)),
      inArray(drivers.lastName, winners.map((d) => d.lastName)),
    ))
    .orderBy(desc(seasons.year));

  const seen = new Set<string>();
  for (const profile of latestProfiles) {
    const key = personKey(profile.driver);
    if (seen.has(key)) continue;
    seen.add(key);

    for (const era of ERAS) {
      const entry = driverWinsByEra[era].get(key);
      if (entry) {
        entry.driver = profile.driver;
        entry.team = profile.team;
      }
    }
  }
}
