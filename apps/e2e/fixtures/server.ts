import {
  predictionResponse, raceDetailResponse, raceControlMessages, raceOvertakes, teamRadioClips, predictionHistory, predictionHistory2026, intelStandings,
  seasons, modelInfo, circuit, pastCircuit, circuitDetailResponse, circuitTelemetry,
  driverCareer, driverBCareer, driverDetailResponse, driverBDetailResponse,
  teamCareer, teamPitStops, teamDetailResponse, driverStandingsResponse, driversListResponse,
  globalSearchResponse,
  teamsListResponse, teamBDetailResponse, teamBCareer,
  sprintPredictionResponse, sprintDetailResponse, sprintWeekendRaceDetailResponse,
  sprintRaceControlMessages, raceStrategyResponse, fridayPaceRows, pitCrewRankings, teamStandingsResponse, race2026DetailResponse,
  races2026, titleOddsResponse, racecraftRows, teammateBattle, raceStoryResponse, telemetryResponse,
  historyRecords, historyMilestones, constructorLineages, driverHistory, teamHistory, lastRaceRecap, lastRaceDetailResponse, onThisDay,
} from './data';

const PORT = Number(process.env.FIXTURE_API_PORT ?? 4310);

// GlobalSearch/DriverCompareTool/TeamCompareTool fetch client-side (see CLAUDE.md), a real
// cross-origin request to this fixture server, so it needs CORS like the real API does.
const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*' };

function ok(data: unknown): Response {
  return Response.json({ data, error: null }, { headers: CORS_HEADERS });
}

function notFound(): Response {
  return Response.json(
    { data: null, error: { code: 'not_found', message: 'no fixture for this route' } },
    { status: 404, headers: CORS_HEADERS }
  );
}

Bun.serve({
  port: PORT,
  fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === '/health') return new Response('ok');

    if (url.pathname === '/api/predictions/model-info') return ok(modelInfo);
    if (url.pathname === '/api/predictions/upcoming') return ok(predictionResponse);
    if (url.pathname === '/api/predictions/history') {
      return ok(url.searchParams.get('year') === '2026' ? predictionHistory2026 : predictionHistory);
    }
    if (url.pathname === '/api/predictions/standings') return ok(intelStandings);
    if (url.pathname === '/api/seasons') return ok(seasons);
    if (url.pathname === '/api/history/records') return ok(historyRecords);
    if (url.pathname === '/api/history/milestones') return ok(historyMilestones);
    if (url.pathname === '/api/history/lineages') return ok(constructorLineages);
    if (url.pathname === '/api/history/on-this-day') return ok(onThisDay(url.searchParams.get('date') ?? ''));
    if (url.pathname === '/api/drivers/10/history') return ok(driverHistory);
    if (url.pathname === '/api/teams/1/history') return ok(teamHistory);
    if (url.pathname === '/api/predictions/title-odds') return ok(titleOddsResponse);
    if (url.pathname === '/api/races' && url.searchParams.get('year') === '2026') return ok(races2026);
    if (url.pathname === '/api/sprint/upcoming') return notFound();
    if (url.pathname === '/api/sprint/race/2') return ok(sprintPredictionResponse);
    if (url.pathname === '/api/sprint/race/2/detail') return ok(sprintDetailResponse);

    if (url.pathname === '/api/races/1') return ok(raceDetailResponse);
    if (url.pathname === '/api/races/2') return ok(sprintWeekendRaceDetailResponse);
    if (url.pathname === '/api/races/3') return ok(race2026DetailResponse);
    if (url.pathname === '/api/races/30/recap') return ok(lastRaceRecap);
    if (url.pathname === '/api/races/30') return ok(lastRaceDetailResponse);
    if (url.pathname === '/api/races/3/team-radio') return ok([]);
    if (url.pathname === '/api/races/2/race-control' && url.searchParams.get('session') === 'sprint') {
      return ok(sprintRaceControlMessages);
    }
    if (url.pathname === '/api/races/1/race-control') return ok(raceControlMessages);
    if (url.pathname === '/api/races/1/overtakes') return ok(raceOvertakes);
    if (url.pathname === '/api/races/1/team-radio') return ok(teamRadioClips);
    if (url.pathname === '/api/races/1/strategy') return ok(raceStrategyResponse);
    if (url.pathname === '/api/races/1/race-story') return ok(raceStoryResponse);
    if (url.pathname === '/api/races/1/telemetry') return ok(telemetryResponse);
    if (url.pathname === '/api/predictions/race/1') return ok(predictionResponse);
    if (url.pathname === '/api/predictions/race/1/friday-pace') return ok(fridayPaceRows);
    if (url.pathname === '/api/races/circuits') return ok([circuit, pastCircuit]);
    if (url.pathname === '/api/races/circuit/monza') return ok(circuitDetailResponse);
    if (url.pathname === '/api/races/circuit/monza/telemetry') return ok(circuitTelemetry);

    if (url.pathname === '/api/search') return ok(globalSearchResponse);

    if (url.pathname === '/api/drivers') return ok(driversListResponse);
    if (url.pathname === '/api/drivers/10') return ok(driverDetailResponse);
    if (url.pathname === '/api/drivers/11') return ok(driverBDetailResponse);
    if (url.pathname === '/api/drivers/10/career') return ok(driverCareer);
    if (url.pathname === '/api/drivers/11/career') return ok(driverBCareer);
    if (url.pathname === '/api/drivers/standings') return ok(driverStandingsResponse);
    if (url.pathname === '/api/drivers/racecraft') return ok(racecraftRows);
    if (url.pathname === '/api/drivers/10/teammate-battle') return ok(teammateBattle);

    if (url.pathname === '/api/teams') return ok(teamsListResponse);
    if (url.pathname === '/api/teams/pit-stops') return ok(pitCrewRankings);
    if (url.pathname === '/api/teams/standings') return ok(teamStandingsResponse);
    if (url.pathname === '/api/teams/1') return ok(teamDetailResponse);
    if (url.pathname === '/api/teams/1/career') return ok(teamCareer);
    if (url.pathname === '/api/teams/1/pit-stops') return ok(teamPitStops);
    if (url.pathname === '/api/teams/2') return ok(teamBDetailResponse);
    if (url.pathname === '/api/teams/2/career') return ok(teamBCareer);

    return notFound();
  },
});

console.log(`[e2e fixture server] listening on http://localhost:${PORT}`);
