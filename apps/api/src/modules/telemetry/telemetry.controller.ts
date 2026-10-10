import type { Context } from 'hono';
import type { Bindings } from '../../common/types';
import { createDb } from '../../config/database';
import { cacheControlForStatus, cacheIfData } from '../../common/cache';
import { findRaceStatus } from '../../common/raceStatus';
import { TelemetryService } from './telemetry.service';

const service = new TelemetryService();

export const TelemetryController = {
  async getComparison(c: Context<{ Bindings: Bindings }>) {
    const id = Number(c.req.param('id'));
    if (isNaN(id)) {
      return c.json({ data: null, error: { code: 'INVALID_ID', message: 'id must be a number' } }, 400);
    }
    const session = c.req.query('session') ?? 'Q';
    if (session !== 'Q' && session !== 'SQ') {
      return c.json({ data: null, error: { code: 'INVALID_SESSION', message: "session must be 'Q' or 'SQ'" } }, 400);
    }
    const db = createDb(c.env.DATABASE_URL);
    const status = await findRaceStatus(db, id);
    if (!status) {
      return c.json({ data: null, error: { code: 'NOT_FOUND', message: `Race ${id} not found` } }, 404);
    }
    const data = await service.findComparison(db, id, session, [c.req.query('a'), c.req.query('b')]);
    c.header('Cache-Control', cacheIfData(cacheControlForStatus(status), data.laps.length > 0));
    return c.json({ data, error: null });
  },
};
