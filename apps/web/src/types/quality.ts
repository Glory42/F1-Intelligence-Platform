export type QualitySeverity = 'high' | 'medium' | 'low';

export type QualityIssue = {
  raceId: number | null; roundNumber: number | null; year: number;
  tableName: string | null; checkName: string; severity: QualitySeverity;
  detail: string | null; fixable: boolean; isSprint: boolean;
};

export type QualityReport = {
  year: number; generatedAt: string; healthScore: string;
  racesAudited: number; issueCount: number; fixableCount: number;
  bySeverity: Record<QualitySeverity, number>;
  byTable: Record<string, number>;
  issues: QualityIssue[];
};
