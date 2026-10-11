import { Home, Flag, Users, Building2, Cpu, ShieldCheck, Trophy, MapPin, ArrowLeftRight, BookOpen, type LucideIcon } from 'lucide-react';

export interface NavDestination {
  href: string;
  label: string;
  icon: LucideIcon;
  owns: string[];
}

export interface NavGroup {
  label: 'season' | 'explore';
  destinations: NavDestination[];
}

export function buildNavGroups(): NavGroup[] {
  return [
    {
      label: 'season',
      destinations: [
        { href: '/', label: 'home', icon: Home, owns: ['/'] },
        { href: '/races', label: 'calendar', icon: Flag, owns: ['/races'] },
        { href: '/drivers', label: 'drivers', icon: Users, owns: ['/drivers'] },
        { href: '/teams', label: 'teams', icon: Building2, owns: ['/teams'] },
        { href: '/prediction', label: 'predictions', icon: Cpu, owns: ['/prediction'] },
      ],
    },
    {
      label: 'explore',
      destinations: [
        { href: '/circuits', label: 'circuits', icon: MapPin, owns: ['/circuits'] },
        { href: '/compare/drivers', label: 'compare', icon: ArrowLeftRight, owns: ['/compare'] },
        { href: '/history', label: 'history', icon: Trophy, owns: ['/history'] },
      ],
    },
  ];
}

export interface NavUtility {
  href: string;
  label: string;
  icon: LucideIcon;
}

export function buildNavUtilities(isDev: boolean): NavUtility[] {
  const utilities: NavUtility[] = [{ href: '/docs', label: 'docs', icon: BookOpen }];
  // The data-quality dashboard reads dev-only reporting tables: never ship its link.
  if (isDev) utilities.push({ href: '/health-quality', label: 'data quality', icon: ShieldCheck });
  return utilities;
}

const ownsPath = (prefix: string, path: string): boolean =>
  prefix === '/' ? path === '/' : path === prefix || path.startsWith(`${prefix}/`);

// Longest owned prefix wins, so a destination can own a sub-path of another one.
export function activeDestination(groups: NavGroup[], path: string): NavDestination | null {
  let best: { destination: NavDestination; length: number } | null = null;
  for (const destination of groups.flatMap((g) => g.destinations)) {
    for (const prefix of destination.owns) {
      if (ownsPath(prefix, path) && prefix.length > (best?.length ?? -1)) {
        best = { destination, length: prefix.length };
      }
    }
  }
  return best?.destination ?? null;
}
