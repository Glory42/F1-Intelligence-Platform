import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
import type { Bindings } from './types';
import { createDb, type Db } from '../config/database';
import { circuits, drivers, races, seasons, teams } from '../db/schema';
import { cacheControlForStatus, cacheControlForYear, cacheIfData } from './cache';
import type { SessionParam } from './session';
import { readsQuery } from './query-params';

type Ctx = Context<{ Bindings: Bindings }>;
type RaceRow = typeof races.$inferSelect;
type CircuitRow = typeof circuits.$inferSelect;
type DriverRow = typeof drivers.$inferSelect;
type TeamRow = typeof teams.$inferSelect;

type Failure = { status: 400 | 404; code: string; message: string };

interface Spec<Req, T, Q extends string = never> {
  load: (req: Req) => Promise<T | null>;
  // Query params `load` reads beyond the factory's own (year, session): the edge cache keys on them.
  query?: readonly Q[];
  // Empty answers are cached briefly so a later backfill shows up; default: an empty array is empty.
  hasData?: (data: T) => boolean;
  // 404 message when `load` finds nothing; called with the route's id (or year).
  missing?: (key: number) => string;
}

interface SeasonScopedSpec<Req, T> extends Spec<Req, T> {
  // When the answer spans seasons (a career), the newest one decides how long it may be cached.
  seasonOf?: (data: T) => number;
}

export type DriverRequest = { db: Db; driver: DriverRow; team: TeamRow; year: number };
export type TeamRequest = { db: Db; team: TeamRow; year: number };
export type SeasonRequest<Q extends string = never> = { db: Db; year: number; query: (name: Q) => string | undefined };
export type RaceRequest<S = undefined, Q extends string = never> = {
  db: Db; race: RaceRow; circuit: CircuitRow; session: S; query: (name: Q) => string | undefined;
};

interface RaceSpec<S, T, Q extends string> extends Spec<RaceRequest<S, Q>, T, Q> {
  param?: 'id' | 'raceId';
  session?: SessionParam<S>;
}

export function newestSeason(rows: { year: number }[]): number {
  return Math.max(...rows.map((r) => r.year));
}

const INT4_MAX = 2_147_483_647;

// No leading zeros: /races/7 and /races/007 would be two cache keys for one race.
export function parseId(value: string | undefined): number | null {
  if (!value || !/^(0|[1-9]\d*)$/.test(value)) return null;
  const id = Number(value);
  return id <= INT4_MAX ? id : null;
}

function fail(c: Ctx, { status, code, message }: Failure) {
  return c.json({ data: null, error: { code, message } }, status);
}

const notFound = (message: string): Failure => ({ status: 404, code: 'NOT_FOUND', message });

function isNonEmpty(data: unknown): boolean {
  return !Array.isArray(data) || data.length > 0;
}

async function respond<Req, T, Q extends string>(
  c: Ctx, spec: Spec<Req, T, Q>, req: Req, missing: string, cacheFor: (data: T) => string,
) {
  const data = await spec.load(req);
  if (data == null) return fail(c, notFound(missing));
  c.header('Cache-Control', cacheIfData(cacheFor(data), (spec.hasData ?? isNonEmpty)(data)));
  return c.json({ data, error: null });
}

const NO_SESSION: SessionParam<undefined> = { parse: () => undefined, error: { code: '', message: '' } };

// Loads the race once: its existence decides the 404 and its status the cache lifetime.
export function raceRoute<T, S = undefined, const Q extends string = never>(spec: RaceSpec<S, T, Q>) {
  const param = spec.param ?? 'id';
  const sessionParam = (spec.session ?? NO_SESSION) as SessionParam<S>;
  const own = spec.session ? ['session'] : [];
  return readsQuery([...own, ...(spec.query ?? [])], async (c: Ctx) => {
    const id = parseId(c.req.param(param));
    if (id == null) return fail(c, { status: 400, code: 'INVALID_ID', message: `${param} must be a number` });
    const session = sessionParam.parse(c.req.query('session'));
    if (session === null) return fail(c, { status: 400, ...sessionParam.error });
    const db = createDb(c.env.DATABASE_URL);
    const [found] = await db
      .select({ race: races, circuit: circuits })
      .from(races)
      .innerJoin(circuits, eq(races.circuitId, circuits.id))
      .where(eq(races.id, id))
      .limit(1);
    if (!found) return fail(c, notFound(`Race ${id} not found`));
    const req = { db, ...found, session, query: (name: Q) => c.req.query(name) };
    const missing = spec.missing?.(id) ?? `Race ${id} not found`;
    return respond(c, spec, req, missing, () => cacheControlForStatus(found.race.status));
  });
}

function parseYear(value: string | undefined): number | null {
  if (value === undefined) return new Date().getFullYear();
  return /^\d{4}$/.test(value) ? Number(value) : null;
}

// The answer is that season's data, so the requested season is the data's own season.
export function seasonRoute<T, const Q extends string = never>(spec: Spec<SeasonRequest<Q>, T, Q>) {
  return readsQuery(['year', ...(spec.query ?? [])], async (c: Ctx) => {
    const year = parseYear(c.req.query('year'));
    if (year == null) return fail(c, { status: 400, code: 'INVALID_YEAR', message: 'year must be a number' });
    const req = { db: createDb(c.env.DATABASE_URL), year, query: (name: Q) => c.req.query(name) };
    const missing = spec.missing?.(year) ?? `Nothing for ${year}`;
    return respond(c, spec, req, missing, () => cacheControlForYear(year));
  });
}

// Driver and team ids are season-scoped, so the row's own season decides the cache lifetime.
function seasonScopedRoute<Found extends { year: number }, T>(
  label: string,
  find: (db: Db, id: number) => Promise<Found | undefined>,
  spec: SeasonScopedSpec<Found & { db: Db }, T>,
) {
  return readsQuery([], async (c: Ctx) => {
    const id = parseId(c.req.param('id'));
    if (id == null) return fail(c, { status: 400, code: 'INVALID_ID', message: 'id must be a number' });
    const db = createDb(c.env.DATABASE_URL);
    const found = await find(db, id);
    if (!found) return fail(c, notFound(`${label} ${id} not found`));
    const missing = spec.missing?.(id) ?? `${label} ${id} not found`;
    return respond(c, spec, { db, ...found }, missing, (data) =>
      cacheControlForYear(spec.seasonOf?.(data) ?? found.year));
  });
}

export function driverRoute<T>(spec: SeasonScopedSpec<DriverRequest, T>) {
  return seasonScopedRoute('Driver', async (db, id) => {
    const [found] = await db
      .select({ driver: drivers, team: teams, year: seasons.year })
      .from(drivers)
      .innerJoin(teams, eq(drivers.teamId, teams.id))
      .innerJoin(seasons, eq(drivers.seasonId, seasons.id))
      .where(eq(drivers.id, id))
      .limit(1);
    return found;
  }, spec);
}

export function teamRoute<T>(spec: SeasonScopedSpec<TeamRequest, T>) {
  return seasonScopedRoute('Team', async (db, id) => {
    const [found] = await db
      .select({ team: teams, year: seasons.year })
      .from(teams)
      .innerJoin(seasons, eq(teams.seasonId, seasons.id))
      .where(eq(teams.id, id))
      .limit(1);
    return found;
  }, spec);
}
