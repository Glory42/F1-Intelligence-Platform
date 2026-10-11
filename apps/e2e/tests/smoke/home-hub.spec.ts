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

test('the next race block lists the weekend schedule and the circuit facts', async ({ page }) => {
  await page.goto('/');

  const next = page.getByRole('region', { name: 'Next race' });
  const schedule = next.getByRole('list', { name: 'Weekend schedule' });
  await expect(schedule.getByRole('listitem')).toHaveCount(2);
  await expect(schedule).toContainText('Qualifying');
  await expect(schedule).toContainText('Race');
  await expect(next).toContainText('5.79 km');
  await expect(next.getByRole('link', { name: /circuit/i })).toHaveAttribute('href', '/circuits/monza');
});

test('the last race block recaps what happened', async ({ page }) => {
  await page.goto('/');

  const recap = page.getByRole('region', { name: 'Last race' });
  const podium = recap.getByRole('list', { name: 'Podium' });
  await expect(podium.getByRole('listitem').first()).toContainText('Charles Leclerc');
  await expect(podium.getByRole('listitem').nth(1)).toContainText('Max Verstappen');
  await expect(recap).toContainText('✗ missed');
  await expect(recap).toContainText('VER · 62%');
  await expect(recap.getByText('Winner ranked').locator('..')).toContainText('#2');
  await expect(recap.getByText('Season calls').locator('..')).toContainText('1 / 2');
  await expect(recap).toContainText('Fastest stop LEC 1.98 s');
  await expect(recap).toContainText('VER chased LEC laps 41–53');
});

test('the championship block shows the top drivers and teams with their title odds', async ({ page }) => {
  await page.goto('/');

  const championship = page.getByRole('region', { name: 'Championship' });
  const drivers = championship.getByRole('list', { name: 'Drivers standings' });
  await expect(drivers.getByRole('listitem').first()).toContainText('VER');
  await expect(drivers.getByRole('listitem').first()).toContainText('100%');
  await expect(championship.getByRole('list', { name: 'Teams standings' })).toContainText('Red Bull Racing');
  await expect(championship).toContainText('after round 19 · 5 rounds left');
});
