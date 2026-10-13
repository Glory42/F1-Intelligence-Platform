import { useMemo } from 'react';
import { api } from '@/lib/api';
import type { Team, TeamDetailResponse, TeamYearStats, SeasonSummary } from '@/types';
import { getTeamColor } from '@/lib/f1/teamColors';
import { getTeamLogo } from '@/lib/f1/teamLogos';
import { aggregateCareerStats, DEFAULT_COMPARE_YEAR } from '../compareStats';
import { seasonStatConfig, careerStatConfig } from '../teamCompareConfig';
import { useCompareController } from '../useCompareController';
import { SearchSelect } from '@/components/ui/search-select';
import { ComparisonRow } from './ComparisonRow';
import { CompareStatus } from './CompareStatus';
import { CompareEntityCard } from './CompareEntityCard';
import { CompareLayout } from './CompareLayout';

interface Props {
  allSeasons: SeasonSummary[];
  initialTeams: Team[];
  allTeams: Team[];
}

const teamSubtitle = (
  <span className="text-[11px] text-muted-foreground block mt-1">Constructor</span>
);

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

  const stats = comparison?.mode === 'season' ? (
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
  );

  return (
    <CompareLayout
      a={{
        select: (
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
        ),
        card: teamA && (
          <CompareEntityCard
            slot="A"
            entityType="team"
            href={`/teams/${teamA.id}${isCareer ? '' : `?year=${year}`}`}
            imageUrl={logoA}
            imageAlt={teamA.name}
            borderColor={colorA}
            name={teamA.name}
            subtitle={teamSubtitle}
          />
        ),
        name: teamA?.name ?? null,
        color: colorA,
      }}
      b={{
        select: (
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
        ),
        card: teamB && (
          <CompareEntityCard
            slot="B"
            entityType="team"
            href={`/teams/${teamB.id}${isCareer ? '' : `?year=${year}`}`}
            imageUrl={logoB}
            imageAlt={teamB.name}
            borderColor={colorB}
            name={teamB.name}
            subtitle={teamSubtitle}
          />
        ),
        name: teamB?.name ?? null,
        color: colorB,
      }}
      years={years}
      year={year}
      setYear={setYear}
      isCareer={isCareer}
      setIsCareer={setIsCareer}
      status={loading || error ? <CompareStatus loading={loading} error={error} entityLabel="teams" /> : null}
      stats={stats}
    />
  );
}
