import type { PageTab } from '@/lib/pageTabs';

export const COMPARE_TABS: readonly PageTab<'drivers' | 'teams'>[] = [
  { id: 'drivers', label: 'Drivers', href: '/compare/drivers' },
  { id: 'teams', label: 'Teams', href: '/compare/teams' },
];
