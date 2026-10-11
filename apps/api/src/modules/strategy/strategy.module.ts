import { Hono } from 'hono';
import type { Bindings } from '../../common/types';
import { StrategyController } from './strategy.controller';

const strategyModule = new Hono<{ Bindings: Bindings }>();

strategyModule.get('/:id/strategy', StrategyController.getStrategy);

export default strategyModule;
