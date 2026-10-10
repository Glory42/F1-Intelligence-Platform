import { Home, Flag, Users, Building2, Cpu, ShieldCheck, Trophy, type LucideIcon } from 'lucide-react';

export interface NavDropdownItem {
  href: string;
  label: string;
}

export interface NavLink {
  href: string;
  label: string;
  icon: LucideIcon;
  dropdown?: NavDropdownItem[];
}

export function buildNavLinks(isDev: boolean): NavLink[] {
  const links: NavLink[] = [
    { href: '/', label: 'home', icon: Home },
    {
      href: '/races',
      label: 'races',
      icon: Flag,
      dropdown: [
        { href: '/races', label: 'seasons' },
        { href: '/circuits', label: 'circuits' },
      ],
    },
    {
      href: '/drivers',
      label: 'drivers',
      icon: Users,
      dropdown: [
        { href: '/drivers', label: 'standings' },
        { href: '/drivers/compare', label: 'comparison' },
      ],
    },
    {
      href: '/teams',
      label: 'teams',
      icon: Building2,
      dropdown: [
        { href: '/teams', label: 'standings' },
        { href: '/teams/compare', label: 'comparison' },
      ],
    },
    {
      href: '/prediction',
      label: 'prediction',
      icon: Cpu,
      dropdown: [
        { href: '/prediction', label: 'hub' },
        { href: '/prediction/recap', label: 'recap' },
      ],
    },
    { href: '/records', label: 'history', icon: Trophy },
  ];

  // The data-quality dashboard reads dev-only reporting tables — never ship its nav link.
  if (isDev) {
    links.push({ href: '/health-quality', label: 'data quality', icon: ShieldCheck });
  }

  return links;
}

export function isNavActive(currentPath: string, href: string, dropdown?: NavDropdownItem[]): boolean {
  if (href === '/') return currentPath === '/';
  if (currentPath.startsWith(href)) return true;
  if (dropdown && dropdown.some((sub) => currentPath.startsWith(sub.href))) return true;
  return false;
}
