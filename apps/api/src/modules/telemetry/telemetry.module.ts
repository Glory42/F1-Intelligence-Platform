import { Hono } from 'hono';
import type { Bindings } from '../../common/types';
import { TelemetryController } from './telemetry.controller';

const telemetryModule = new Hono<{ Bindings: Bindings }>();

telemetryModule.get('/:id/telemetry', TelemetryController.getComparison);

export default telemetryModule;
