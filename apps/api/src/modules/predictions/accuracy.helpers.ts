import type { AccuracyBucket, PredictionHistoryItem, SeasonAccuracy } from '../../common/types';

function toBucket(items: PredictionHistoryItem[]): AccuracyBucket {
  const decided = items.filter((i) => i.correct !== null);
  const correct = decided.filter((i) => i.correct === true).length;
  return {
    races: decided.length,
    correct,
    accuracyPct: decided.length > 0 ? Math.round((correct / decided.length) * 100) : null,
  };
}

// Year comes from raceDate's 'YYYY-MM-DD' prefix, not Date/getFullYear(), to sidestep
// timezone ambiguity. Splits GP vs sprint so one doesn't skew the other's accuracy.
export function aggregateAccuracyBySeason(items: PredictionHistoryItem[]): SeasonAccuracy[] {
  const byYear = new Map<number, { gp: PredictionHistoryItem[]; sprint: PredictionHistoryItem[] }>();

  for (const item of items) {
    const year = Number(item.raceDate.slice(0, 4));
    if (!byYear.has(year)) byYear.set(year, { gp: [], sprint: [] });
    const bucket = byYear.get(year)!;
    (item.isSprint ? bucket.sprint : bucket.gp).push(item);
  }

  return Array.from(byYear.entries())
    .map(([year, { gp, sprint }]) => ({
      year,
      gp: toBucket(gp),
      sprint: toBucket(sprint),
      overall: toBucket([...gp, ...sprint]),
    }))
    // A season with predictions but no race run yet (overall.races === 0) has nothing to report.
    .filter((season) => season.overall.races > 0)
    .sort((a, b) => b.year - a.year);
}
