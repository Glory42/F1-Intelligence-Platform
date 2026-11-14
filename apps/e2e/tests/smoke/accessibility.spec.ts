import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Key pages, one per kind of view: hub, lists, a race with its charts, standings with title odds.
const PAGES = [
  '/', '/races?year=2026', '/races/1', '/races/1/race-story', '/races/1/telemetry',
  '/drivers?tab=title-fight&year=2025', '/prediction', '/prediction/1', '/history', '/circuits/monza',
];
const BLOCKING = new Set(['serious', 'critical']);

for (const path of PAGES) {
  test(`${path} has no serious accessibility violations`, async ({ page }) => {
    await page.goto(path);
    const { violations } = await new AxeBuilder({ page })
      // Low-contrast muted text is a site-wide palette question, fixed and re-enabled separately (#93 E).
      .disableRules(['color-contrast'])
      .analyze();

    const blocking = violations
      .filter((v) => BLOCKING.has(v.impact ?? ''))
      .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
    expect(blocking).toEqual([]);
  });
}

test('team-mates on the race story chart are told apart by dash, not only colour', async ({ page }) => {
  await page.goto('/races/1/race-story');

  const chart = page.getByRole('img', { name: 'Position per lap' });
  const dashes = await chart.locator('path').evaluateAll((paths) => paths.map((p) => p.getAttribute('stroke-dasharray')));
  expect(dashes).toContain('6 3');
  await expect(chart.locator('desc')).toHaveText('Last values: VER 1 at lap 4; LEC 2 at lap 4; TSU 3 at lap 4.');
});
