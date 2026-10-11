import { test, expect } from '@playwright/test';

test('the records page leads with headline records and ranks leaders with flags and active drivers', async ({ page }) => {
  await page.goto('/records');

  await expect(page.getByRole('group', { name: 'Most championships: 7' })).toContainText('Michael Schumacher');
  const wins = page.getByRole('table', { name: 'Most race wins' });
  await expect(wins.getByRole('row', { name: /Lewis Hamilton.*106/ })).toBeVisible();
  await expect(wins.getByRole('link', { name: 'Max Verstappen' })).toHaveAttribute('href', '/drivers/10');
  await expect(wins.getByRole('row', { name: /Max Verstappen/ }).getByTitle('On the current grid')).toBeVisible();
  await expect(page.getByRole('table', { name: 'Best win rate' })).toContainText('47.1%');
  await expect(page.getByText('F1DB')).toBeVisible();
});

test('former drivers link to their page without the current-grid marker', async ({ page }) => {
  await page.goto('/records');

  const schumacher = page.getByRole('table', { name: 'Most race wins' }).getByRole('row', { name: /Michael Schumacher/ });
  await expect(schumacher.getByRole('link', { name: 'Michael Schumacher' })).toHaveAttribute('href', '/drivers/20');
  await expect(schumacher.getByTitle('On the current grid')).toHaveCount(0);
});

test('the records page shows how far active drivers are from each record', async ({ page }) => {
  await page.goto('/records');

  const chases = page.getByRole('list', { name: 'Chasing the record' });
  await expect(chases).toContainText('Max Verstappen');
  await expect(chases).toContainText('34 wins to match · 35 to pass');
});

test('history keeps milestones, on this day and lineage in tabs', async ({ page }) => {
  await page.goto('/records');

  const views = page.getByRole('navigation', { name: 'History views' });
  await expect(views.getByRole('link')).toHaveText(['Records', 'Milestones', 'On this day', 'Lineage']);
  await expect(views.getByRole('link', { name: 'Records' })).toHaveAttribute('aria-current', 'page');

  await views.getByRole('link', { name: 'Milestones' }).click();
  await expect(page).toHaveURL(/\/records\?tab=milestones$/);
  await expect(page.getByRole('table', { name: 'Youngest winners' })).toContainText('18 y 228 d');
  await expect(page.getByRole('table', { name: 'Oldest first-time winners' })).toContainText('Luigi Fagioli');
});

test('on this day steps between dates and falls back to the nearest day with a race', async ({ page }) => {
  await page.goto('/records?tab=on-this-day&date=09-08');

  await expect(page.getByRole('list', { name: /^On this day/ }).getByRole('link', { name: /2019 · Italian Grand Prix/ })).toBeVisible();
  await page.getByRole('navigation', { name: 'Change date' }).getByRole('link', { name: /9 September/ }).click();
  await expect(page).toHaveURL(/date=09-09/);

  await page.goto('/records?tab=on-this-day&date=12-25');
  await expect(page.getByText(/No Grand Prix on 25 December — showing the nearest date/)).toBeVisible();
  await expect(page.getByRole('list', { name: 'On this day, 13 December' })).toBeVisible();
});

test('the lineage tab traces a team through every name it raced under', async ({ page }) => {
  await page.goto('/records?tab=lineage');

  const family = page.getByRole('list', { name: 'Red Bull lineage' });
  await expect(family.getByRole('listitem')).toHaveText([/Stewart.*1997–1999/, /Jaguar.*2000–2004/, /Red Bull.*2005–/]);
  await expect(page.getByRole('list', { name: 'Team family trees' }).getByRole('link', { name: 'Red Bull' }).first()).toHaveAttribute('href', '/teams/1');
  await expect(family.getByRole('link', { name: 'Jaguar' })).toHaveAttribute('href', '/teams/5');
  await expect(family.getByRole('link', { name: 'Stewart' })).toHaveCount(0);
});

test('the driver page shows all-time career totals and milestones', async ({ page }) => {
  await page.goto('/drivers/10?year=2026&tab=career');

  const career = page.getByRole('region', { name: 'All-time career' });
  await expect(career).toContainText('72');
  await expect(career).toContainText('First win');
  await expect(career).toContainText('Formula 1 Gran Premio de España Pirelli 2016');
});

test('the team page shows its chassis and engine lineage', async ({ page }) => {
  await page.goto('/teams/1?year=2026&tab=history');

  await expect(page.getByRole('table', { name: 'Season by season' }).getByRole('row', { name: /2026.*RB22.*Red Bull Ford/ })).toBeVisible();
});
