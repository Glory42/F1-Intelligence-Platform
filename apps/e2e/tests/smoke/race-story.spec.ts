import { test, expect } from '@playwright/test';

test('the race page links to a race story with gap, position and battle analysis', async ({ page }) => {
  await page.goto('/races/1');
  await page.getByRole('link', { name: 'Race story' }).click();

  await expect(page).toHaveURL(/\/races\/1\/race-story$/);
  await expect(page.getByRole('img', { name: 'Gap to the leader per lap' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Position per lap' })).toBeVisible();
  const battles = page.getByRole('table', { name: 'Battles' });
  await expect(battles.getByRole('row', { name: /2–4.*Charles Leclerc.*Max Verstappen.*0\.60 s/ })).toBeVisible();
});

test('the race story shows the session weather with the rain spells', async ({ page }) => {
  await page.goto('/races/1/race-story');

  await expect(page.getByRole('img', { name: 'Track temperature over the session' })).toBeVisible();
  await expect(page.getByText('Rain: minutes 2–3')).toBeVisible();
});
