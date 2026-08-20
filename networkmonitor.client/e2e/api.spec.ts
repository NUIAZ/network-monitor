import { test, expect } from '@playwright/test';

/**
 * API-level end-to-end checks.
 *
 * These hit the real HTTP surface against the seeded demo database. They are
 * deliberately assertion-light on exact numbers (the seeder can grow) and
 * strict on shape and invariants: the things a client will actually break on.
 */

test.describe('Dashboard API', () => {
    test('summary reports a populated demo estate', async ({ request }) => {
        const res = await request.get('/api/dashboard/summary');
        expect(res.ok()).toBeTruthy();

        const summary = await res.json();
        expect(summary.totalDevices).toBeGreaterThan(50);
        expect(summary.sites).toBeGreaterThanOrEqual(4);
        expect(summary.networks).toBeGreaterThanOrEqual(4);

        // Every device is in exactly one of the three states, so the parts
        // must never exceed the whole.
        expect(summary.onlineDevices + summary.offlineDevices).toBeLessThanOrEqual(summary.totalDevices);

        // nmapAvailable is a boolean either way; its value depends on the host,
        // but the field must always be present so the UI can render the banner.
        expect(typeof summary.nmapAvailable).toBe('boolean');
    });

    test('device type breakdown covers the whole inventory', async ({ request }) => {
        const [summaryRes, typesRes] = await Promise.all([
            request.get('/api/dashboard/summary'),
            request.get('/api/dashboard/device-types'),
        ]);

        const summary = await summaryRes.json();
        const types: Array<{ deviceType: string; count: number }> = await typesRes.json();

        expect(types.length).toBeGreaterThan(1);
        const total = types.reduce((sum, t) => sum + t.count, 0);
        expect(total).toBe(summary.totalDevices);
    });

    test('scan activity returns one point per requested day', async ({ request }) => {
        const res = await request.get('/api/dashboard/scan-activity?days=14');
        const points = await res.json();

        expect(Array.isArray(points)).toBeTruthy();
        expect(points.length).toBeLessThanOrEqual(14);
        for (const p of points) expect(p).toHaveProperty('date');
    });
});

test.describe('Devices API', () => {
    test('paging metadata is self-consistent', async ({ request }) => {
        const res = await request.get('/api/devices?page=1&pageSize=10');
        const page = await res.json();

        expect(page.items.length).toBeLessThanOrEqual(10);
        expect(page.page).toBe(1);
        expect(page.pageSize).toBe(10);
        expect(page.totalPages).toBe(Math.ceil(page.total / page.pageSize));
    });

    test('page 2 returns different devices than page 1', async ({ request }) => {
        const [first, second] = await Promise.all([
            request.get('/api/devices?page=1&pageSize=5').then(r => r.json()),
            request.get('/api/devices?page=2&pageSize=5').then(r => r.json()),
        ]);

        const firstIds = new Set(first.items.map((d: { id: number }) => d.id));
        const overlap = second.items.filter((d: { id: number }) => firstIds.has(d.id));
        expect(overlap).toHaveLength(0);
    });

    test('status filter returns only matching devices', async ({ request }) => {
        const res = await request.get('/api/devices?status=online&pageSize=50');
        const page = await res.json();

        expect(page.items.length).toBeGreaterThan(0);
        for (const device of page.items) expect(device.status).toBe('online');
    });

    test('search matches hostname or IP', async ({ request }) => {
        const all = await request.get('/api/devices?pageSize=1').then(r => r.json());
        const sample = all.items[0];
        const term = (sample.hostname ?? sample.ipAddress).slice(0, 6);

        const res = await request.get(`/api/devices?search=${encodeURIComponent(term)}&pageSize=50`);
        const page = await res.json();

        expect(page.total).toBeGreaterThan(0);
        for (const device of page.items) {
            const haystack = `${device.hostname ?? ''} ${device.ipAddress}`.toLowerCase();
            expect(haystack).toContain(term.toLowerCase());
        }
    });

    test('device detail includes ports and related records', async ({ request }) => {
        const list = await request.get('/api/devices?pageSize=1').then(r => r.json());
        const res = await request.get(`/api/devices/${list.items[0].id}`);
        expect(res.ok()).toBeTruthy();

        const device = await res.json();
        expect(device).toHaveProperty('ipAddress');
        expect(device).toHaveProperty('ports');
        expect(Array.isArray(device.ports)).toBeTruthy();
    });

    test('unknown device id returns 404, not 500', async ({ request }) => {
        const res = await request.get('/api/devices/99999999');
        expect(res.status()).toBe(404);
    });

    test('topology returns the nested site to device shape', async ({ request }) => {
        const res = await request.get('/api/devices/topology');
        expect(res.ok()).toBeTruthy();

        const topology = await res.json();
        const sites = topology.sites ?? topology;
        expect(Array.isArray(sites)).toBeTruthy();
        expect(sites.length).toBeGreaterThan(0);
        expect(sites[0].networks.length).toBeGreaterThan(0);
    });
});

test.describe('Alerts API', () => {
    test('acknowledging an alert persists', async ({ request }) => {
        const open = await request
            .get('/api/alerts?acknowledged=false&pageSize=1')
            .then(r => r.json());

        test.skip(open.items.length === 0, 'no unacknowledged alerts in the demo data');
        const alert = open.items[0];

        const ack = await request.post(`/api/alerts/${alert.id}/acknowledge`, {
            data: { acknowledgedBy: 'e2e' },
        });
        expect(ack.ok()).toBeTruthy();

        const after = await request.get(`/api/alerts?acknowledged=true&pageSize=100`).then(r => r.json());
        expect(after.items.some((a: { id: number }) => a.id === alert.id)).toBeTruthy();
    });

    test('severity filter is honoured', async ({ request }) => {
        const res = await request.get('/api/alerts?severity=critical&pageSize=25');
        const page = await res.json();
        for (const alert of page.items) expect(alert.severity).toBe('critical');
    });
});

test.describe('Security API', () => {
    test('vulnerabilities carry a CVE id and a severity', async ({ request }) => {
        const page = await request.get('/api/vulnerabilities?pageSize=20').then(r => r.json());

        expect(page.total).toBeGreaterThan(0);
        for (const v of page.items) {
            expect(v.cveId).toMatch(/^CVE-\d{4}-\d{4,}$/);
            expect(['critical', 'high', 'medium', 'low']).toContain(v.severity);
        }
    });

    test('certificates expose days until expiry', async ({ request }) => {
        const page = await request.get('/api/certificates?pageSize=20').then(r => r.json());

        expect(page.total).toBeGreaterThan(0);
        for (const c of page.items) expect(typeof c.daysUntilExpiry).toBe('number');
    });
});

test.describe('Scan safety', () => {
    test('a malformed CIDR is rejected before it can reach a command line', async ({ request }) => {
        // The network create path is the only place a user-supplied target
        // enters the system, so it must refuse anything that is not a CIDR.
        const res = await request.post('/api/networks', {
            data: {
                siteId: 1,
                name: 'injection attempt',
                cidr: '203.0.113.0/24; whoami',
            },
        });

        expect(res.status()).toBeGreaterThanOrEqual(400);
        expect(res.status()).toBeLessThan(500);
    });
});
