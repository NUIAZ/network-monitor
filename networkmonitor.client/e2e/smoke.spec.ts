/**
 * Smoke: the shell renders, navigation works, and every page mounts without
 * a blank screen. Requires a running app with the API reachable (the pages
 * still render their empty/error states if the API is down, which is itself
 * part of the contract this spec asserts).
 */
import { expect, test } from '@playwright/test';

test('shell renders with sidebar and dashboard', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('sidebar')).toBeVisible();
  await expect(page.getByTestId('nav-menu')).toBeVisible();
  await expect(page.getByTestId('page-title')).toHaveText('Dashboard');
});

test('sidebar navigates to every page', async ({ page }) => {
  await page.goto('/');
  const routes: Array<[testId: string, title: string]> = [
    ['nav-link-devices', 'Devices'],
    ['nav-link-scan-history', 'Scan History'],
    ['nav-link-alerts', 'Alerts'],
    ['nav-link-vulnerabilities', 'Vulnerabilities'],
    ['nav-link-certificates', 'Certificates'],
    ['nav-link-network-map', 'Network Map'],
    ['nav-link-switches', 'Switches'],
    ['nav-link-settings', 'Settings'],
  ];
  for (const [testId, title] of routes) {
    await page.getByTestId(testId).click();
    await expect(page.getByTestId('page-title')).toHaveText(title);
    // The page body must never be blank: some card, table, empty state, or
    // error banner has to be present.
    await expect(page.locator('.page-content > *').first()).toBeVisible();
  }
});

test('global search routes to the filtered device list', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('global-search').fill('10.0.0');
  await page.getByTestId('global-search').press('Enter');
  await expect(page).toHaveURL(/\/devices\?search=10\.0\.0/);
});
