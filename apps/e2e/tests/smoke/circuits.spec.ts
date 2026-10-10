import { test, expect, type Page } from '@playwright/test';

const views = (page: Page) => page.getByRole('navigation', { name: 'Circuits views' });

test("the circuits page shows this season's circuits, with every circuit one tab away", async ({ page }) => {
  await page.goto('/circuits');

  await expect(views(page).getByRole('link')).toHaveText(['This season', 'All circuits']);
  await expect(page.getByRole('link', { name: /Autodromo Nazionale Monza/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Hockenheimring/ })).toHaveCount(0);

  await views(page).getByRole('link', { name: 'All circuits' }).click();
  await expect(page).toHaveURL(/\/circuits\?tab=all$/);
  await expect(page.getByRole('link', { name: /Hockenheimring/ })).toBeVisible();
});
