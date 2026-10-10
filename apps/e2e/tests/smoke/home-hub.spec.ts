import { test, expect } from '@playwright/test';

test('the home hub recaps the last race and the title fight even when one card has no data', async ({ page }) => {
  await page.goto('/');

  const recap = page.getByRole('region', { name: 'Last race' });
  await expect(recap).toContainText('LEC won');
  await expect(recap).toContainText('Model picked VER');
  await expect(recap).toContainText('Fastest stop LEC 1.98 s');
  await expect(recap).toContainText('VER chased LEC laps 41–53');
  await expect(page.getByRole('region', { name: 'Championship' })).toContainText('VER');
  await expect(page.getByRole('region', { name: 'On this day' })).toHaveCount(0);
  await expect(page.getByText(/failed to load/i)).toHaveCount(0);
});
