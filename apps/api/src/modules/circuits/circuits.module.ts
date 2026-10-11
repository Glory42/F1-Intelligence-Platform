import { Hono } from 'hono';
import type { Bindings } from '../../common/types';
import { CircuitsController } from './circuits.controller';

// Mounted under /api/races (the public URLs predate this module), ahead of the races module's /:id.
const circuitsModule = new Hono<{ Bindings: Bindings }>();

circuitsModule.get('/circuits', CircuitsController.getAll);
circuitsModule.get('/circuit/:circuitKey', CircuitsController.getDetails);
circuitsModule.get('/circuit/:circuitKey/telemetry', CircuitsController.getTelemetry);

export default circuitsModule;
