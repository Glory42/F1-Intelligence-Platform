import { useMemo } from 'react';
import { api } from '@/lib/api';
import type { Team, TeamDetailResponse, TeamSeasonStats, TeamYearStats, SeasonSummary } from '@/types';
import { getTeamColor } from '@/lib/teamColors';
import { getTeamLogo } from '@/lib/teamLogos';
import { aggregateCareerStats, DEFAULT_COMPARE_YEAR, type CareerTotals } from '../compareStats';
import { Zap } from 'lucide-react';
import { useCompareController } from '../useCompareController';
import { SearchSelect } from '@/components/ui/search-select';
import { ComparisonRow, type StatRowConfig } from './ComparisonRow';
import { CompareModeToggle } from './CompareModeToggle';
import { CompareYearSelect } from './CompareYearSelect';
import { CompareStatus } from './CompareStatus';
import { CompareEntityCard } from './CompareEntityCard';

interface Props {
  allSeasons: SeasonSummary[];
  initialTeams: Team[];
  allTeams: Team[];
}

const teamSubtitle = (
  <span className="text-[11px] text-muted-foreground block mt-1">Constructor</span>
);

const seasonStatConfig: StatRowConfig<TeamSeasonStats>[] = [
  {
    label: 'Championship Points',
    value: (s) => parseFloat(s.totalPoints),
    format: (v) => v.toString(),
  },
  { label: 'Grand Prix Wins', value: (s) => s.wins },
  { label: 'Podiums Secured', value: (s) => s.podiums },
  {
    label: 'Car Performance Score',
    value: (s) => parseFloat(s.carPerformanceScore || '0'),
    format: (v) => v.toFixed(1),
  },
  {
    label: 'Reliability Score',
    value: (s) => parseFloat(s.reliabilityScore || '0') * 100,
    format: (v) => `${Math.round(v)}%`,
  },
  { label: 'Constructor DNFs', value: (s) => s.dnfCount, lowerBetter: true },
  {
    label: 'Avg Finish Position',
    value: (s) => parseFloat(s.avgFinishPosition || '20'),
    format: (v) => `P${v.toFixed(1)}`,
    lowerBetter: true,
  },
];

const careerStatConfig: StatRowConfig<CareerTotals>[] = [
  {
    label: 'Best Championship Finish',
    value: (c) => c.bestFin || 10,
    format: (v) => (v === 10 ? '—' : `P${v}`),
    lowerBetter: true,
  },
  { label: 'Total Points', value: (c) => c.points, format: (v) => v.toFixed(1) },
  { label: 'Career Wins', value: (c) => c.wins },
  { label: 'Career Podiums', value: (c) => c.podiums },
  { label: 'Races Completed', value: (c) => c.entries },
  { label: 'Total DNFs', value: (c) => c.dnfs, lowerBetter: true },
];

export function TeamCompareTool({ allSeasons, initialTeams, allTeams }: Props) {
  const years = useMemo(() => allSeasons.map((s) => s.year).sort((a, b) => b - a), [allSeasons]);
  const defaultYear = years[0] || DEFAULT_COMPARE_YEAR;

  const {
    year,
    items: teams,
    aId: teamAId,
    bId: teamBId,
    itemA: teamA, itemB: teamB,
    isCareer,
    comparison,
    loading, error,
    actions: { setYear, setAId: setTeamAId, setBId: setTeamBId, setIsCareer },
  } = useCompareController<Team, TeamDetailResponse, TeamYearStats>({
    years,
    defaultYear,
    initialItems: initialTeams,
    allItems: allTeams,
    entityLabel: 'teams',
    fetchItemsForYear: (y) => api.getTeams(y),
    fetchDetail: (id, y) => api.getTeamById(id, y),
    fetchCareer: (id) => api.getTeamCareer(id),
  });

  const teamACareer = comparison?.mode === 'career' ? comparison.a : null;
  const teamBCareer = comparison?.mode === 'career' ? comparison.b : null;

  const logoA = useMemo(() => getTeamLogo(teamA?.teamKey || ''), [teamA]);
  const logoB = useMemo(() => getTeamLogo(teamB?.teamKey || ''), [teamB]);

  const colorA = useMemo(() => getTeamColor(teamA?.teamKey || ''), [teamA]);
  const colorB = useMemo(() => getTeamColor(teamB?.teamKey || ''), [teamB]);

  // Compute Career summaries
  const careerA = useMemo(() => aggregateCareerStats(teamACareer, (s) => s.racesCompleted), [teamACareer]);
  const careerB = useMemo(() => aggregateCareerStats(teamBCareer, (s) => s.racesCompleted), [teamBCareer]);

  const teamMatches = (t: Team, q: string) => t.name.toLowerCase().includes(q);
  const teamInputLabel = (t: Team) => t.name;
  const teamOption = (t: Team) => t.name;

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex flex-col md:flex-row gap-4 items-stretch md:items-center justify-between border-b border-white/[0.06] pb-5">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 flex-1 max-w-3xl">
          <div className="flex-1 min-w-[200px]">
            <SearchSelect<Team>
              items={teams}
              selectedId={teamAId}
              onSelect={setTeamAId}
              placeholder="Search Constructor A..."
              getInputLabel={teamInputLabel}
              renderOption={teamOption}
              matches={teamMatches}
              noResultsLabel="No constructors found"
            />
          </div>

          <div className="flex justify-center shrink-0">
            <span className="font-mono text-[9px] tracking-widest text-muted-foreground uppercase px-2 align-middle self-center">vs</span>
          </div>

          <div className="flex-1 min-w-[200px]">
            <SearchSelect<Team>
              items={teams}
              selectedId={teamBId}
              onSelect={setTeamBId}
              placeholder="Search Constructor B..."
              getInputLabel={teamInputLabel}
              renderOption={teamOption}
              matches={teamMatches}
              noResultsLabel="No constructors found"
            />
          </div>
        </div>

        <div className="flex items-center gap-3 justify-end">
          {!isCareer && <CompareYearSelect years={years} year={year} setYear={setYear} />}

          <CompareModeToggle isCareer={isCareer} setIsCareer={setIsCareer} />
        </div>
      </div>

      {loading || error ? (
        <CompareStatus loading={loading} error={error} entityLabel="teams" />
      ) : (
        <div key="content" className="fade-swap space-y-8">
          {/* Team Profile Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {teamA && (
              <CompareEntityCard
                entityType="team"
                href={`/teams/${teamA.id}${isCareer ? '' : `?year=${year}`}`}
                imageUrl={logoA}
                imageAlt={teamA.name}
                borderColor={colorA}
                name={teamA.name}
                subtitle={teamSubtitle}
              />
            )}

            {teamB && (
              <CompareEntityCard
                entityType="team"
                href={`/teams/${teamB.id}${isCareer ? '' : `?year=${year}`}`}
                imageUrl={logoB}
                imageAlt={teamB.name}
                borderColor={colorB}
                name={teamB.name}
                subtitle={teamSubtitle}
              />
            )}
          </div>

          {/* Stats metrics */}
          <div className="border border-white/[0.06] bg-black p-6 space-y-6">
            <div className="flex items-center gap-2 font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">
              <Zap size={11} /> head-to-head comparison
            </div>

            <div className="space-y-4">
              {comparison?.mode === 'season' ? (
                <>
                  {seasonStatConfig.map((row) => (
                    <ComparisonRow
                      key={row.label}
                      label={row.label}
                      valA={row.value(comparison.a.seasonStats)}
                      valB={row.value(comparison.b.seasonStats)}
                      format={row.format}
                      lowerBetter={row.lowerBetter}
                      colorA={colorA} colorB={colorB}
                    />
                  ))}
                </>
              ) : comparison?.mode === 'career' && careerA && careerB ? (
                <>
                  {careerStatConfig.map((row) => (
                    <ComparisonRow
                      key={row.label}
                      label={row.label}
                      valA={row.value(careerA)}
                      valB={row.value(careerB)}
                      format={row.format}
                      lowerBetter={row.lowerBetter}
                      colorA={colorA} colorB={colorB}
                    />
                  ))}
                </>
              ) : (
                <CompareStatus loading={false} error={null} entityLabel="teams" />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
