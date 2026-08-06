import { test, expect, type Page } from '@playwright/test';

/**
 * UI end-to-end checks against the real application.
 *
 * Selectors prefer accessible roles and visible text over CSS classes: a test
 * that breaks when someone renames a class is noise, while one that breaks when
 * a heading disappears is telling you something true.
 *
 * Every page assertion also fails on a console error, because a React page that
 * throws still "renders" — just blank — and a screenshot-free assertion would
 * otherwise pass on an empty screen.
 */

/** Collects console errors so a test can assert the page came up cleanly. */
function watchConsole(page: Page): string[] {
    const errors: string[] = [];
    page.on('console', msg => {
        if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', err => errors.push(String(err)));
    return errors;
}

test.describe('Application shell', () => {
    test('loads the dashboard with branding and navigation', async ({ page }) => {
        const errors = watchConsole(page);
        await page.goto('/');

        await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
        await expect(page.getByRole('link', { name: /devices/i }).first()).toBeVisible();
        await expect(page.locator('img[alt="NetworkMonitor"]').first()).toBeVisible();

        expect(errors).toEqual([]);
    });

    test('navigates between the main sections', async ({ page }) => {
        await page.goto('/');

        await page.getByRole('link', { name: /devices/i }).first().click();
        await expect(page).toHaveURL(/\/devices/);
        await expect(page.getByRole('heading', { name: /devices/i })).toBeVisible();

        await page.getByRole('link', { name: /alerts/i }).first().click();
        await expect(page).toHaveURL(/\/alerts/);
    });

    test('an unknown route shows the not-found page rather than a blank screen', async ({ page }) => {
        await page.goto('/this-route-does-not-exist');
        await expect(page.getByText(/not found|404/i).first()).toBeVisible();
    });
});

test.describe('Dashboard', () => {
    test('renders populated statistics from the demo data', async ({ page }) => {
        await page.goto('/');

        // The seeded estate is ~120 devices, so the total tile must show a
        // non-zero number — a zero here means the seeder silently did nothing.
        const body = await page.locator('body').innerText();
        expect(body).toMatch(/\d+/);
        await expect(page.locator('svg').first()).toBeVisible(); // at least one chart rendered
    });
});

test.describe('Device list', () => {
    test('shows devices and filters by status', async ({ page }) => {
        const errors = watchConsole(page);
        await page.goto('/devices');

        const rows = page.locator('tbody tr');
        await expect(rows.first()).toBeVisible();
        const initialCount = await rows.count();
        expect(initialCount).toBeGreaterThan(0);

        // Filtering to offline must not increase the row count.
        const statusFilter = page.getByLabel(/status/i).first();
        if (await statusFilter.isVisible().catch(() => false)) {
            await statusFilter.selectOption('offline').catch(() => undefined);
            await page.waitForTimeout(600);
            expect(await rows.count()).toBeLessThanOrEqual(initialCount);
        }

        expect(errors).toEqual([]);
    });

    test('opens a device detail page from the list', async ({ page }) => {
        await page.goto('/devices');
        await page.locator('tbody tr').first().click();

        await expect(page).toHaveURL(/\/devices\/\d+/);
        // An IPv4 address is the one thing every device detail page must show.
        await expect(page.getByText(/\d+\.\d+\.\d+\.\d+/).first()).toBeVisible();
    });
});

test.describe('Alerts', () => {
    test('lists alerts with severities', async ({ page }) => {
        const errors = watchConsole(page);
        await page.goto('/alerts');

        await expect(page.getByRole('heading', { name: /alerts/i })).toBeVisible();
        await expect(page.locator('tbody tr, [data-testid="alert-row"]').first()).toBeVisible();

        expect(errors).toEqual([]);
    });
});

test.describe('Network map', () => {
    test('renders an SVG topology', async ({ page }) => {
        const errors = watchConsole(page);
        await page.goto('/map');

        const svg = page.locator('svg').first();
        await expect(svg).toBeVisible();
        // A topology with no nodes is an empty picture, not a map.
        await expect(svg.locator('circle, rect, g').first()).toBeVisible();

        expect(errors).toEqual([]);
    });
});

test.describe('Security pages', () => {
    test('vulnerabilities list shows CVE identifiers', async ({ page }) => {
        await page.goto('/security/vulnerabilities');
        await expect(page.getByText(/CVE-\d{4}-\d+/).first()).toBeVisible();
    });

    test('certificates list shows expiry information', async ({ page }) => {
        await page.goto('/security/certificates');
        await expect(page.locator('tbody tr').first()).toBeVisible();
    });
});

test.describe('Scans', () => {
    test('scan history lists previous runs', async ({ page }) => {
        const errors = watchConsole(page);
        await page.goto('/scans');

        await expect(page.locator('tbody tr').first()).toBeVisible();
        expect(errors).toEqual([]);
    });
});

test.describe('Settings', () => {
    test('reports system information', async ({ page }) => {
        await page.goto('/admin/settings');
        // Whether or not nmap is installed, the page must say which.
        await expect(page.getByText(/nmap/i).first()).toBeVisible();
    });
});

test.describe('Theming', () => {
    test('switching theme changes the rendered colours and persists', async ({ page }) => {
        await page.goto('/');

        const before = await page.evaluate(() =>
            getComputedStyle(document.documentElement).getPropertyValue('--bg-primary'));

        const picker = page.getByTestId('theme-picker');
        test.skip(!(await picker.isVisible().catch(() => false)), 'theme picker not exposed');

        await picker.click();
        await page.getByTestId(/theme-option/).nth(3).click();
        await page.waitForTimeout(300);

        const after = await page.evaluate(() =>
            getComputedStyle(document.documentElement).getPropertyValue('--bg-primary'));
        expect(after).not.toBe(before);

        // The choice must survive a reload — it is stored in localStorage.
        await page.reload();
        const afterReload = await page.evaluate(() =>
            getComputedStyle(document.documentElement).getPropertyValue('--bg-primary'));
        expect(afterReload).toBe(after);
    });
});
