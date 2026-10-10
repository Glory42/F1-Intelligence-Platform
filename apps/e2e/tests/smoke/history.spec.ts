import { test, expect } from '@playwright/test';

test('the records page lists all-time leaders and the youngest winner', async ({ page }) => {
  await page.goto('/records');

  await expect(page.getByRole('table', { name: 'Most race wins' }).getByRole('row', { name: /Lewis Hamilton.*106/ })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Youngest winners' })).toContainText('Max Verstappen');
  await expect(page.getByRole('table', { name: 'Youngest winners' })).toContainText('18 y 228 d');
  await expect(page.getByText('F1DB')).toBeVisible();
});

test('the driver page shows all-time career totals and milestones', async ({ page }) => {
  await page.goto('/drivers/10?year=2026');

  const career = page.getByRole('region', { name: 'All-time career' });
  await expect(career).toContainText('72');
  await expect(career).toContainText('First win');
  await expect(career).toContainText('Formula 1 Gran Premio de España Pirelli 2016');
});

test('the team page shows its chassis and engine lineage', async ({ page }) => {
  await page.goto('/teams/1?year=2026');

  await expect(page.getByRole('table', { name: 'Chassis and engines' }).getByRole('row', { name: /2026.*RB22.*Red Bull Ford/ })).toBeVisible();
});
