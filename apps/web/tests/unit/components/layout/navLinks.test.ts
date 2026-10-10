import { describe, expect, it } from 'vitest';
import { activeDestination, buildNavGroups, buildNavUtilities } from '@/components/layout/navLinks';

const labelsByGroup = () =>
  buildNavGroups().map((group) => [group.label, group.destinations.map((d) => d.label)]);

describe('buildNavGroups', () => {
  it('splits the site into the current Season and all-time Explore destinations', () => {
    expect(labelsByGroup()).toEqual([
      ['season', ['home', 'calendar', 'drivers', 'teams', 'predictions']],
      ['explore', ['circuits', 'compare', 'history']],
    ]);
  });
});

describe('buildNavUtilities', () => {
  const labels = (isDev: boolean) => buildNavUtilities(isDev).map((link) => link.label);

  it('always links the docs', () => {
    expect(labels(false)).toEqual(['docs']);
  });

  // The data-quality dashboard reads dev-only reporting tables.
  it('adds the data-quality dashboard only in dev', () => {
    expect(labels(true)).toEqual(['docs', 'data quality']);
  });
});

describe('activeDestination', () => {
  const activeLabel = (path: string) => activeDestination(buildNavGroups(), path)?.label ?? null;

  it.each([
    ['/', 'home'],
    ['/races', 'calendar'],
    ['/races/12/telemetry', 'calendar'],
    ['/drivers', 'drivers'],
    ['/drivers/42', 'drivers'],
    ['/drivers/compare', 'compare'],
    ['/teams/compare', 'compare'],
    ['/teams/7', 'teams'],
    ['/prediction/recap/2025', 'predictions'],
    ['/prediction/sprint/88', 'predictions'],
    ['/circuits/monza', 'circuits'],
    ['/records', 'history'],
  ])('lights up the destination that owns %s', (path, expected) => {
    expect(activeLabel(path)).toBe(expected);
  });

  it('lights up nothing for pages outside the sidebar groups', () => {
    expect(activeLabel('/docs/model')).toBeNull();
    expect(activeLabel('/racesx')).toBeNull();
  });
});
