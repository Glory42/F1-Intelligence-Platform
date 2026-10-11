import { test, expect, type Page } from '@playwright/test';

const siteNav = (page: Page) => page.getByRole('navigation', { name: 'Site' });

test('the sidebar lists every destination in Season and Explore groups', async ({ page }) => {
  await page.goto('/');

  const season = siteNav(page).getByRole('list', { name: 'season' });
  const explore = siteNav(page).getByRole('list', { name: 'explore' });
  await expect(season.getByRole('link')).toHaveText(['home', 'calendar', 'drivers', 'teams', 'predictions']);
  await expect(explore.getByRole('link')).toHaveText(['circuits', 'compare', 'history']);
});

test('the sidebar marks the destination that owns the current page', async ({ page }) => {
  await page.goto('/compare/drivers');

  await expect(siteNav(page).getByRole('link', { name: 'compare' })).toHaveAttribute('aria-current', 'page');
  await expect(siteNav(page).getByRole('link', { name: 'drivers' })).not.toHaveAttribute('aria-current', 'page');
});

test('a collapsed sidebar stays collapsed across navigation and reloads', async ({ page }) => {
  await page.goto('/');
  const toggle = page.getByRole('button', { name: 'Collapse sidebar' });
  await toggle.click();

  await expect(page.getByRole('button', { name: 'Expand sidebar' })).toHaveAttribute('aria-expanded', 'false');

  await siteNav(page).getByRole('link', { name: 'calendar' }).click();
  await expect(page).toHaveURL(/\/races$/);
  await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible();
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the menu button opens the same grouped destinations as a drawer', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Open menu' }).click();

    const drawer = page.getByRole('dialog', { name: 'Navigation menu' });
    await expect(drawer.getByRole('list', { name: 'season' }).getByRole('link')).toHaveCount(5);
    await expect(drawer.getByRole('list', { name: 'explore' }).getByRole('link')).toHaveCount(3);

    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
  });
});
