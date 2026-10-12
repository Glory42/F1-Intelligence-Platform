import { RACE_SESSION } from '../../common/session';
import { raceRoute } from '../../common/route';
import { StrategyService } from './strategy.service';

const service = new StrategyService();

export const StrategyController = {
  getStrategy: raceRoute({
    session: RACE_SESSION,
    load: ({ db, race, session }) => service.findStrategy(db, race.id, session),
    hasData: (data) => data.source !== 'none',
  }),
};
