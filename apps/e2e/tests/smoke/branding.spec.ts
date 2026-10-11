import { test, expect } from '@playwright/test';

test('the dashboard title carries the platform brand exactly once', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle('Dashboard | F1 Intelligence Platform');
});
