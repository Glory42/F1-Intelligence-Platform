import { QUALIFYING_SESSION } from '../../common/session';
import { raceRoute } from '../../common/route';
import { TelemetryService } from './telemetry.service';

const service = new TelemetryService();

export const TelemetryController = {
  getComparison: raceRoute({
    session: QUALIFYING_SESSION,
    load: ({ db, race, session, query }) => service.findComparison(db, race.id, session, [query('a'), query('b')]),
    hasData: (data) => data.laps.length > 0,
  }),
};
