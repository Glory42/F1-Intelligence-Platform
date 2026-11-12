import { test, expect, type Page } from '@playwright/test';

const views = (page: Page) => page.getByRole('navigation', { name: 'Predictions views' });

test('the predictions page leads with the upcoming pick and grades the model in a Scorecard tab', async ({ page }) => {
  const response = await page.goto('/prediction');
  expect(response?.status()).toBe(200);

  await expect(views(page).getByRole('link')).toHaveText(['Upcoming', 'Scorecard']);
  await expect(views(page).getByRole('link', { name: 'Upcoming' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText('Max Verstappen').first()).toBeVisible();
  await expect(page.getByRole('region', { name: 'Scorecard' })).toHaveCount(0);
  await expect(page.getByText(/failed to load/i)).toHaveCount(0);
});

test("the Scorecard grades the model's season race by race", async ({ page }) => {
  await page.goto('/prediction?tab=scorecard&year=2025');

  const scorecard = page.getByRole('region', { name: 'Scorecard' });
  await expect(scorecard.getByText('P1 hit', { exact: true }).locator('..')).toContainText('100%');
  await expect(scorecard.getByRole('list', { name: 'Race by race' }).getByRole('link', { name: /Italian Grand Prix/ })).toBeVisible();
});

test('the Scorecard grades the whole field against the pole and equal-chances baselines', async ({ page }) => {
  await page.goto('/prediction?tab=scorecard&year=2025');

  const scorecard = page.getByRole('region', { name: 'Scorecard' });
  await expect(scorecard.getByText('Brier (GP)', { exact: true }).locator('..')).toContainText('0.071');
  await expect(scorecard.getByRole('img', { name: /Model calibration/ })).toBeVisible();
  const scores = scorecard.getByRole('table', { name: 'Forecast scores' });
  for (const value of ['0.071', '0.083', '0.950', '1.512']) {
    await expect(scores.getByRole('row', { name: /2025/ })).toContainText(value);
  }
  await expect(scores.getByRole('row', { name: /2024/ })).toContainText('0.091');
  await expect(scorecard).toContainText('Pole gives the pole-sitter 42%');
});

test('the old season recap URL lands on that season’s Scorecard', async ({ page }) => {
  await page.goto('/prediction/recap/2025');

  await expect(page).toHaveURL(/\/prediction\?tab=scorecard&year=2025$/);
  await expect(page.getByRole('region', { name: 'Scorecard' })).toBeVisible();
});

test('each GP driver shows the podium chance their win chance implies', async ({ page }) => {
  await page.goto('/prediction/1');

  await expect(page.getByText('podium 88%')).toBeVisible();
  await expect(page.getByText('podium 79%')).toBeVisible();
});

test('a GP driver shows how qualifying moved their chance from the forecast before it', async ({ page }) => {
  await page.goto('/prediction/1');

  await expect(page.getByText('▲ 17 after qualifying')).toBeVisible();
});
