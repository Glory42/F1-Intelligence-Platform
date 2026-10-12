import { Hono } from 'hono';
import { desc, eq, and, isNull, sql } from 'drizzle-orm';
import type { Bindings, QualityReport, QualityIssue, QualitySeverity } from '../../common/types';
import type { Db } from '../../config/database';
import { dataQualityRuns, dataQualityIssues } from '../../db/schema';
import { seasonRoute } from '../../common/route';

export function castSeverity(s: string): QualitySeverity {
  return s === 'high' || s === 'medium' || s === 'low' ? s : 'medium';
}

async function findLatestQualityReport(db: Db, year: number): Promise<QualityReport | null> {
  const run = await db
    .select()
    .from(dataQualityRuns)
    .where(and(eq(dataQualityRuns.year, year), isNull(dataQualityRuns.raceId)))
    .orderBy(desc(dataQualityRuns.generatedAt))
    .limit(1);

  const latest = run[0];
  if (!latest) return null;

  const issueRows = await db
    .select()
    .from(dataQualityIssues)
    .where(eq(dataQualityIssues.runId, latest.id))
    .orderBy(sql`case ${dataQualityIssues.severity} when 'high' then 0 when 'medium' then 1 else 2 end`);

  const summary = (latest.summary ?? {}) as Record<string, unknown>;
  const bySeverity = summary.by_severity as Record<QualitySeverity, number> | undefined;
  const byTable = (summary.by_table ?? {}) as Record<string, number>;

  const issues: QualityIssue[] = issueRows.map((r) => ({
    raceId: r.raceId,
    roundNumber: r.roundNumber,
    year: r.year,
    tableName: r.tableName,
    checkName: r.checkName,
    severity: castSeverity(r.severity),
    detail: r.detail,
    fixable: r.fixable,
    isSprint: r.isSprint,
  }));

  return {
    year: latest.year,
    generatedAt: latest.generatedAt.toISOString(),
    healthScore: String(latest.healthScore),
    racesAudited: Number(summary.races_audited ?? 0),
    issueCount: Number(summary.issue_count ?? issues.length),
    fixableCount: Number(summary.fixable_count ?? 0),
    bySeverity: {
      high: Number(bySeverity?.high ?? 0),
      medium: Number(bySeverity?.medium ?? 0),
      low: Number(bySeverity?.low ?? 0),
    },
    byTable,
    issues,
  };
}

const qualityModule = new Hono<{ Bindings: Bindings }>();

qualityModule.get('/', seasonRoute({
  load: ({ db, year }) => findLatestQualityReport(db, year),
  missing: (year) => `No quality report for ${year}`,
}));

export default qualityModule;
