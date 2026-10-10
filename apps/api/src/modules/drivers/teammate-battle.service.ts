import { and, eq, inArray, ne } from 'drizzle-orm';
import type { Db } from '../../config/database';
import { drivers, qualifyingResults, raceResults, teams } from '../../db/schema';
import type { HeadToHead, TeammateBattle } from '../../common/types';
import { toDriver } from '../../common/mappers';
import { isClassifiedFinish } from '../../common/classification';

interface Outing {
  qualiPosition: number | null;
  finishPosition: number | null;
  status: string | null;
  points: number;
}

const EMPTY: HeadToHead = { driver: 0, teammate: 0 };

function score(mine: Map<number, Outing>, theirs: Map<number, Outing>) {
  const qualifying = { ...EMPTY };
  const race = { ...EMPTY };
  const points = { ...EMPTY };
  let sharedRaces = 0;
  for (const [raceId, a] of mine) {
    const b = theirs.get(raceId);
    if (!b) continue;
    sharedRaces += 1;
    points.driver += a.points;
    points.teammate += b.points;
    if (a.qualiPosition != null && b.qualiPosition != null) {
      if (a.qualiPosition < b.qualiPosition) qualifying.driver += 1;
      else qualifying.teammate += 1;
    }
    // Only races both finished — a retirement says little about who was quicker.
    if (isClassifiedFinish(a.status) && isClassifiedFinish(b.status) && a.finishPosition != null && b.finishPosition != null) {
      if (a.finishPosition < b.finishPosition) race.driver += 1;
      else race.teammate += 1;
    }
  }
  return { sharedRaces, qualifying, race, points };
}

export class TeammateBattleService {
  async findBattle(db: Db, driverId: number): Promise<TeammateBattle | null> {
    const [self] = await db.select().from(drivers).where(eq(drivers.id, driverId)).limit(1);
    if (!self) return null;

    const teammates = await db
      .select({ driver: drivers, team: teams })
      .from(drivers)
      .innerJoin(teams, eq(drivers.teamId, teams.id))
      .where(and(eq(drivers.seasonId, self.seasonId), eq(drivers.teamId, self.teamId), ne(drivers.id, self.id)));
    const ids = [self.id, ...teammates.map((t) => t.driver.id)];

    const rows = await db
      .select({
        raceId: raceResults.raceId,
        driverId: raceResults.driverId,
        finishPosition: raceResults.finishPosition,
        status: raceResults.status,
        points: raceResults.points,
        qualiPosition: qualifyingResults.gridPosition,
      })
      .from(raceResults)
      .leftJoin(
        qualifyingResults,
        and(eq(qualifyingResults.raceId, raceResults.raceId), eq(qualifyingResults.driverId, raceResults.driverId)),
      )
      .where(inArray(raceResults.driverId, ids));

    const outings = new Map<number, Map<number, Outing>>(ids.map((id) => [id, new Map()]));
    for (const r of rows) {
      outings.get(r.driverId)!.set(r.raceId, {
        qualiPosition: r.qualiPosition, finishPosition: r.finishPosition, status: r.status, points: Number(r.points ?? 0),
      });
    }

    const mine = outings.get(self.id)!;
    const ranked = teammates
      .map((t) => ({ teammate: t, battle: score(mine, outings.get(t.driver.id)!) }))
      .sort((x, y) => y.battle.sharedRaces - x.battle.sharedRaces);
    const primary = ranked[0];
    if (!primary) return { teammate: null, sharedRaces: 0, qualifying: EMPTY, race: EMPTY, points: EMPTY };
    return { teammate: toDriver(primary.teammate.driver, primary.teammate.team), ...primary.battle };
  }
}
