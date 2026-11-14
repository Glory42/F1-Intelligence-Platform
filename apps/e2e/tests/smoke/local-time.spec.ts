import { test, expect } from '@playwright/test';

test.use({ timezoneId: 'Asia/Tokyo', locale: 'en-GB' });

test("session times show in the visitor's timezone, also after a client-side navigation", async ({ page }) => {
  await page.goto('/races/1');
  // The fixture GP starts 13:00 UTC: 22:00 in Tokyo.
  await expect(page.locator('time[data-local-time]').first()).toHaveText('7 September 2025 at 22:00 GMT+9');

  await page.goto('/prediction');
  await page.locator('a[href="/prediction/1"]').first().click();
  await expect(page).toHaveURL(/\/prediction\/1$/);
  await expect(page.getByText('Computed:')).toContainText('7 September 2025 at 21:00 GMT+9');
});
