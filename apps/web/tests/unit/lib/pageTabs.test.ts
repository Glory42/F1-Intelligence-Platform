import { describe, expect, it } from 'vitest';
import { resolveTab, tabHref } from '@/lib/pageTabs';

const DRIVER_TABS = [
  { id: 'standings', label: 'Standings' },
  { id: 'title-fight', label: 'Title fight' },
  { id: 'racecraft', label: 'Racecraft' },
] as const;

const at = (path: string) => new URL(path, 'https://example.test');

describe('resolveTab', () => {
  it('opens the first tab when the URL names none', () => {
    expect(resolveTab(at('/drivers?year=2024'), DRIVER_TABS)).toBe('standings');
  });

  it('opens the tab the URL names', () => {
    expect(resolveTab(at('/drivers?tab=racecraft'), DRIVER_TABS)).toBe('racecraft');
  });

  it('falls back to the first tab for a tab the page does not have', () => {
    expect(resolveTab(at('/drivers?tab=lap-chart'), DRIVER_TABS)).toBe('standings');
  });
});

describe('tabHref', () => {
  it('keeps the chosen season when switching tab', () => {
    expect(tabHref(at('/drivers?year=2024'), DRIVER_TABS, 'racecraft')).toBe('/drivers?year=2024&tab=racecraft');
  });

  it('drops the tab from the URL for the default tab', () => {
    expect(tabHref(at('/drivers?year=2024&tab=racecraft'), DRIVER_TABS, 'standings')).toBe('/drivers?year=2024');
    expect(tabHref(at('/drivers?tab=racecraft'), DRIVER_TABS, 'standings')).toBe('/drivers');
  });
});
