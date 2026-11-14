import { test, expect } from '@playwright/test';

test('the races page offers the session calendar as a subscription', async ({ page }) => {
  await page.goto('/races?year=2026');

  const subscribe = page.getByRole('group', { name: 'Subscribe to the session calendar' });
  await expect(subscribe.getByRole('link', { name: 'Subscribe' })).toHaveAttribute('href', /^webcal:\/\/.+\/calendar\.ics$/);
  await expect(subscribe.getByRole('link', { name: 'Google' })).toHaveAttribute('href', /calendar\.google\.com.*cid=webcal/);
});

test('the calendar feed is valid iCalendar with every scheduled session', async ({ request }) => {
  const response = await request.get('/calendar.ics');
  const ics = await response.text();

  expect(response.headers()['content-type']).toContain('text/calendar');
  expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
  // The 2026 fixture rounds reuse the Italian GP: race 30 starts 13:00 UTC, qualifying the day before.
  expect(ics).toContain('UID:race-30-race@');
  expect(ics).toContain('SUMMARY:Italian Grand Prix: Race\r\nLOCATION:');
  expect(ics).toContain('DTSTART:20250907T130000Z\r\nDTEND:20250907T150000Z\r\n');
  expect(ics).toContain('UID:race-30-qualifying@');
  expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
});
