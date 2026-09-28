import { test, expect } from '@playwright/test';

// ADAPT: this SPA has a single route, '/', which renders the welcome screen.
test('home page loads without errors or horizontal overflow', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await expect(page.locator('body')).toBeVisible();
  // ADAPT: assert this app's real entry content, not a generic placeholder.
  await expect(page.locator('h1')).toContainText('HYROX journey');

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth
  );
  expect(overflow, 'page scrolls horizontally on this viewport').toBe(false);
  expect(errors, 'uncaught page errors').toEqual([]);
});
