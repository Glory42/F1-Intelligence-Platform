import { test, expect } from '@playwright/test';

test('draws the circuit from real pole-lap telemetry when there is no track image', async ({ page }) => {
  await page.goto('/circuits/monza');

  await expect(page.getByRole('img', { name: 'Autodromo Nazionale Monza layout from pole-lap telemetry' })).toBeVisible();
});

test('the circuit page leads with an overview and keeps the rest in tabs', async ({ page }) => {
  await page.goto('/circuits/monza');

  const views = page.getByRole('navigation', { name: 'Circuit views' });
  await expect(views.getByRole('link')).toHaveText(['Overview', 'Winners', 'Dominance', 'Telemetry']);
  await expect(page.getByRole('heading', { name: 'Recent Winners' })).toHaveCount(0);

  await views.getByRole('link', { name: 'Winners' }).click();
  await expect(page).toHaveURL(/\/circuits\/monza\?tab=winners$/);
  await expect(page.getByRole('heading', { name: 'Recent Winners' })).toBeVisible();
});

test('the winners tab pairs the winners list with how races here are won', async ({ page }) => {
  await page.goto('/circuits/monza?tab=winners');

  const facts = page.getByRole('complementary', { name: 'How races here are won' });
  await expect(facts).toContainText('1:20.800');
  await expect(facts.getByText('Pole to win').locator('..')).toContainText('50%');
  await expect(facts.getByText('Avg winner start').locator('..')).toContainText('P1.8');
});

test("the telemetry tab profiles the circuit from a real qualifying lap", async ({ page }) => {
  await page.goto('/circuits/monza?tab=telemetry');

  const tele = page.getByRole('region', { name: 'Track telemetry' });
  await expect(tele).toContainText("Max Verstappen's pole lap");
  await expect(tele.getByText('Full throttle', { exact: true }).last().locator('..')).toContainText('81%');
  await expect(tele.getByText('Top speed', { exact: true }).locator('..')).toContainText('345 km/h');
  await expect(tele.getByRole('img', { name: /Speed trace/ })).toBeVisible();
  await expect(tele).toContainText('9 corners by apex speed');
});
