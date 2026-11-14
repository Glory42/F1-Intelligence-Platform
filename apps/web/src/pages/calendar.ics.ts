import type { APIRoute } from 'astro';
import { buildRaceCalendar } from '@/features/races/raceCalendarFeed';

export const GET: APIRoute = async ({ site, url }) => {
  const now = new Date();
  const body = await buildRaceCalendar(now.getUTCFullYear(), site ?? url, now);
  if (body === null) return new Response('Calendar unavailable', { status: 503, headers: { 'Retry-After': '600' } });
  return new Response(body, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="f1-calendar.ics"',
    },
  });
};
