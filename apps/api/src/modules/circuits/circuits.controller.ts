import type { Context } from 'hono';
import type { Bindings } from '../../common/types';
import { createDb } from '../../config/database';
import { CircuitsService } from './circuits.service';
import { CACHE_REFERENCE, cacheControlForYear, cacheIfData } from '../../common/cache';

const service = new CircuitsService();

// Keyed by circuit key, not a race or season id, so these stay outside common/route.ts.
export const CircuitsController = {
  getAll: async (c: Context<{ Bindings: Bindings }>) => {
    const data = await service.findAllCircuits(createDb(c.env.DATABASE_URL));
    c.header('Cache-Control', CACHE_REFERENCE);
    return c.json({ data, error: null });
  },

  getDetails: async (c: Context<{ Bindings: Bindings }>) => {
    const circuitKey = c.req.param('circuitKey') ?? '';
    const data = await service.findCircuitDetails(createDb(c.env.DATABASE_URL), circuitKey);
    if (!data) {
      return c.json({ data: null, error: { code: 'NOT_FOUND', message: `Circuit ${circuitKey} not found` } }, 404);
    }
    c.header('Cache-Control', CACHE_REFERENCE);
    return c.json({ data, error: null });
  },

  getTelemetry: async (c: Context<{ Bindings: Bindings }>) => {
    const circuitKey = c.req.param('circuitKey') ?? '';
    const data = await service.findCircuitTelemetry(createDb(c.env.DATABASE_URL), circuitKey);
    c.header('Cache-Control', cacheIfData(cacheControlForYear(data?.year ?? new Date().getFullYear()), data != null));
    return c.json({ data, error: null });
  },
};
