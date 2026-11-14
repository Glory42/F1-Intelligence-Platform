import { test, expect } from '@playwright/test';

test("the dynamic sitemap lists the season's detail pages", async ({ request }) => {
  const response = await request.get('/sitemap-dynamic.xml');
  const xml = await response.text();

  expect(response.headers()['content-type']).toContain('application/xml');
  expect(xml).toContain('/races/30</loc>');
  expect(xml).toContain('/drivers/10</loc>');
  expect(xml).toContain('/teams/1</loc>');
  expect(xml).toContain('/circuits/monza</loc>');
});
