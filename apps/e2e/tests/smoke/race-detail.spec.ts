import { test, expect } from '@playwright/test';

test('renders race results, qualifying, and prediction against fixture data', async ({ page }) => {
  const response = await page.goto('/races/1');
  expect(response?.status()).toBe(200);

  await expect(page.getByText('Italian Grand Prix').first()).toBeVisible();
  await expect(page.getByText('Monza', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('Max Verstappen').first()).toBeVisible();

  await expect(page.getByText(/failed to load/i)).toHaveCount(0);
});

test('renders the incidents tab with race control messages', async ({ page }) => {
  await page.goto('/races/1');

  await page.getByRole('tab', { name: 'Incidents' }).click();
  await expect(page.getByText('SAFETY CAR DEPLOYED')).toBeVisible();
  await expect(page.getByText('YELLOW IN TRACK SECTOR 4')).toBeVisible();
});

test('renders the overtakes tab with driver codes and before/after positions', async ({ page }) => {
  await page.goto('/races/1');

  await page.getByRole('tab', { name: 'Overtakes' }).click();
  const panel = page.locator('#panel-overtakes');
  await expect(panel.getByText('VER', { exact: true })).toBeVisible();
  await expect(panel.getByText('LEC', { exact: true })).toBeVisible();
  await expect(panel.getByText('passed')).toBeVisible();
  await expect(panel.getByText('VER → P2')).toBeVisible();
  await expect(panel.getByText('LEC → P3')).toBeVisible();
});

test('renders the team radio tab with a custom player', async ({ page }) => {
  await page.goto('/races/1');

  await page.getByRole('tab', { name: 'Team Radio' }).click();
  const panel = page.locator('#panel-team-radio');
  await expect(panel.getByText('VER', { exact: true })).toBeVisible();
  await expect(panel.locator('audio source')).toHaveAttribute('src', 'https://example.com/clip-ver.mp3');

  const playBtn = panel.locator('.radio-play-btn');
  await expect(playBtn.locator('.radio-icon-play')).toBeVisible();
  await expect(playBtn.locator('.radio-icon-pause')).toBeHidden();
  await expect(panel.locator('.radio-progress')).toBeVisible();
});

test('renders the strategy tab with stints per compound and the pit stops', async ({ page }) => {
  await page.goto('/races/1');
  await page.getByRole('tab', { name: 'Strategy' }).click();

  const panel = page.locator('#panel-strategy');
  await expect(panel.getByRole('img', { name: 'VER: MEDIUM, laps 1–20' })).toBeVisible();
  await expect(panel.getByRole('img', { name: 'LEC: HARD (used), laps 1–53' })).toBeVisible();
  await expect(panel.getByRole('row', { name: /VER.*20.*2\.30 s/ })).toBeVisible();
});

test('explains an empty team radio list for 2026+ races', async ({ page }) => {
  await page.goto('/races/3');
  await page.getByRole('tab', { name: 'Team Radio' }).click();

  await expect(page.locator('#panel-team-radio')).toContainText('far fewer team radio clips since 2026');
});

test('flags drivers who started behind their qualifying position', async ({ page }) => {
  await page.goto('/races/3');

  await expect(page.locator('#panel-results')).toContainText('LEC qualified P2, started P12 (−10)');
});

test('the race tab row never scrolls vertically and its indicator follows the selected tab', async ({ page }) => {
  await page.goto('/races/1');

  const tablist = page.getByRole('tablist').first();
  const overflowY = await tablist.evaluate((el) => el.scrollHeight - el.clientHeight);
  expect(overflowY).toBe(0);

  const strategy = page.getByRole('tab', { name: 'Strategy' });
  await strategy.click();
  const indicator = tablist.locator('[data-tab-indicator]');
  await expect(async () => {
    const [tabBox, barBox] = [await strategy.boundingBox(), await indicator.boundingBox()];
    expect(Math.abs(tabBox!.x - barBox!.x)).toBeLessThan(1);
    expect(Math.abs(tabBox!.width - barBox!.width)).toBeLessThan(1);
  }).toPass();
});
