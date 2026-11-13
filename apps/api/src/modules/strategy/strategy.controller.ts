import { RACE_SESSION } from '../../common/session';
import { raceRoute } from '../../common/route';
import { StrategyService } from './strategy.service';
import { StrategyInsightsService } from './strategy-insights.service';

const service = new StrategyService();
const insights = new StrategyInsightsService();

export const StrategyController = {
  getStrategy: raceRoute({
    session: RACE_SESSION,
    load: ({ db, race, session }) => service.findStrategy(db, race.id, session),
    hasData: (data) => data.source !== 'none',
  }),

  getInsights: raceRoute({
    session: RACE_SESSION,
    load: ({ db, race, session }) => insights.findInsights(db, race.id, session),
    hasData: (data) => data.degradation.length > 0 || data.pitBattles.length > 0,
  }),
};
