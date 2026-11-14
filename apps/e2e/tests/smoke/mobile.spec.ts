import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.use({ viewport: { width: 375, height: 800 } });

const PAGES = [
  '/', '/races?year=2026', '/races/1', '/races/2', '/races/1/race-story', '/races/1/telemetry',
  '/drivers?year=2025', '/drivers?year=2025&tab=title-fight', '/drivers/10?year=2026&tab=teammate',
  '/teams?year=2026', '/teams/1?year=2026&tab=pit-crew', '/prediction', '/prediction/1',
  '/prediction?tab=scorecard&year=2025', '/history?tab=milestones', '/circuits/monza',
  '/compare/drivers?year=2025&a=10&b=11',
];

const pageOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const path of PAGES) {
  test(`${path} fits a 375 px phone without sideways scrolling`, async ({ page }) => {
    await page.goto(path);
    expect(await pageOverflow(page)).toBe(0);
  });
}

test('wide charts scroll inside their panel instead of shrinking their labels', async ({ page }) => {
  await page.goto('/races/1/race-story');

  const chart = page.getByRole('img', { name: 'Position per lap' });
  const box = await chart.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(1080 * 0.8);
  expect(await chart.evaluate((svg) => svg.parentElement!.scrollWidth > svg.parentElement!.clientWidth)).toBe(true);
});

test('the scorecard keeps the season column in view while its table scrolls', async ({ page }) => {
  await page.goto('/prediction?tab=scorecard&year=2025');

  const table = page.getByRole('table', { name: 'Forecast scores' });
  const season = table.getByRole('rowheader').first();
  const before = (await season.boundingBox())!.x;
  await table.evaluate((t) => { t.parentElement!.scrollLeft = 200; });
  expect((await season.boundingBox())!.x).toBe(before);
});

test('the qualifying grid fits three sessions on a phone', async ({ page }) => {
  await page.goto('/races/2');
  await page.getByRole('tab', { name: 'Qualifying' }).click();

  const grid = page.getByRole('table').filter({ hasText: 'Q3' }).first();
  expect(await grid.evaluate((t) => t.parentElement!.scrollWidth - t.parentElement!.clientWidth)).toBeLessThanOrEqual(0);
});

for (const path of ['/races/1', '/races/1/race-story']) {
  test(`${path} has no serious accessibility violations on a phone`, async ({ page }) => {
    await page.goto(path);
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
  });
}
