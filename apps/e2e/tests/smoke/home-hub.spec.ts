import { test, expect } from '@playwright/test';

test('home is exactly three blocks: next race, last race and the championship', async ({ page }) => {
  await page.goto('/');

  const main = page.getByRole('main');
  await expect(main.getByRole('region')).toHaveCount(3);
  await expect(main.getByRole('region', { name: 'Next race' })).toBeVisible();
  await expect(main.getByRole('region', { name: 'Last race' })).toBeVisible();
  await expect(main.getByRole('region', { name: 'Championship' })).toBeVisible();
  await expect(page.getByText(/failed to load/i)).toHaveCount(0);
});

test("the next race block counts down and names the model's favourite", async ({ page }) => {
  await page.goto('/');

  const next = page.getByRole('region', { name: 'Next race' });
  await expect(next).toContainText('Italian Grand Prix');
  await expect(next).toContainText('VER');
  await expect(next.getByRole('link', { name: /prediction/i })).toHaveAttribute('href', '/prediction');
});

test('the last race block recaps what happened', async ({ page }) => {
  await page.goto('/');

  const recap = page.getByRole('region', { name: 'Last race' });
  await expect(recap).toContainText('LEC won');
  await expect(recap).toContainText('Model picked VER');
  await expect(recap).toContainText('Fastest stop LEC 1.98 s');
  await expect(recap).toContainText('VER chased LEC laps 41–53');
});

test('the championship block shows the top drivers and teams', async ({ page }) => {
  await page.goto('/');

  const championship = page.getByRole('region', { name: 'Championship' });
  await expect(championship).toContainText('VER');
  await expect(championship).toContainText('Red Bull Racing');
});
