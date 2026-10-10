import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatMs(ms: number | null | undefined): string {
  if (ms == null) return '—';
  const total = ms / 1000;
  const mins = Math.floor(total / 60);
  const secs = (total % 60).toFixed(3).padStart(6, '0');
  return mins > 0 ? `${mins}:${secs}` : `${secs}s`;
}

export function formatProbability(p: string | number): string {
  return `${(Number(p) * 100).toFixed(1)}%`;
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function unwrapSettled<T>(result: PromiseSettledResult<T>, fallback: T): T {
  return result.status === 'fulfilled' ? result.value : fallback;
}

export function formatStopSeconds(ms: number | null | undefined): string {
  return ms == null ? '—' : `${(ms / 1000).toFixed(2)} s`;
}

export function formatAgeFromDays(days: number): string {
  const years = Math.floor(days / 365.25);
  return `${years} y ${days - Math.floor(years * 365.25)} d`;
}
