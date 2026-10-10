import { Hono } from 'hono';
import type { Bindings } from '../../common/types';
import { HistoryController } from './history.controller';

const historyModule = new Hono<{ Bindings: Bindings }>();

historyModule.get('/records', HistoryController.getRecords);
historyModule.get('/on-this-day', HistoryController.getOnThisDay);

export default historyModule;
