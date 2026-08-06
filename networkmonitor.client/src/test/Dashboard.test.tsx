/**
 * Dashboard page against a fully mocked API: stat tiles carry the summary
 * numbers, and the nmap banner appears exactly when the server says nmap is
 * missing.
 */
import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Dashboard from '../Components/Dashboard/Dashboard';
import { mockFetchRoutes } from './mockFetch';

function mockDashboard(nmapAvailable: boolean) {
  mockFetchRoutes({
    '/api/dashboard/summary': {
      totalDevices: 128,
      onlineDevices: 117,
      offlineDevices: 9,
      newDevices24h: 4,
      openAlerts: 12,
      criticalAlerts: 2,
      sites: 3,
      networks: 6,
      lastScanAt: '2026-08-05T11:30:00Z',
      openVulnerabilities: 21,
      criticalVulnerabilities: 3,
      expiringCerts: 5,
      nmapAvailable,
      nmapVersion: nmapAvailable ? '7.95' : null,
    },
    '/api/dashboard/device-types': [
      { deviceType: 'server', count: 40 },
      { deviceType: 'workstation', count: 60 },
      { deviceType: 'printer', count: 28 },
    ],
    '/api/dashboard/scan-activity': [
      { date: '2026-08-04', scans: 24, hostsUp: 110, newDevices: 1 },
      { date: '2026-08-05', scans: 22, hostsUp: 117, newDevices: 3 },
    ],
    '/api/dashboard/alert-trend': [
      { date: '2026-08-04', info: 3, warning: 2, critical: 0 },
      { date: '2026-08-05', info: 5, warning: 1, critical: 2 },
    ],
    '/api/alerts': {
      items: [
        {
          id: 1,
          deviceId: 9,
          networkId: 1,
          alertType: 'device_offline',
          severity: 'critical',
          message: 'Device 10.0.0.9 went offline',
          details: null,
          isAcknowledged: false,
          acknowledgedBy: null,
          acknowledgedAt: null,
          createdAt: '2026-08-05T11:00:00Z',
        },
      ],
      page: 1,
      pageSize: 6,
      total: 12,
      totalPages: 2,
    },
  });
}

function renderDashboard() {
  return render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>,
  );
}

describe('Dashboard', () => {
  it('renders stat tiles from the summary payload', async () => {
    mockDashboard(true);
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByTestId('stat-total-devices-value')).toHaveTextContent('128');
    });
    expect(screen.getByTestId('stat-online-value')).toHaveTextContent('117');
    expect(screen.getByTestId('stat-offline-value')).toHaveTextContent('9');
    expect(screen.getByTestId('stat-alerts-value')).toHaveTextContent('12');
    expect(screen.getByTestId('stat-vulns-value')).toHaveTextContent('21');
    expect(screen.getByTestId('stat-certs-value')).toHaveTextContent('5');
  });

  it('lists recent alerts', async () => {
    mockDashboard(true);
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByTestId('recent-alerts')).toHaveTextContent('Device 10.0.0.9 went offline');
    });
  });

  it('hides the nmap banner when nmap is available', async () => {
    mockDashboard(true);
    renderDashboard();
    await waitFor(() => expect(screen.getByTestId('dashboard')).toBeInTheDocument());
    expect(screen.queryByTestId('nmap-banner')).toBeNull();
  });

  it('shows the nmap banner when the server reports nmap missing', async () => {
    mockDashboard(false);
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByTestId('nmap-banner')).toHaveTextContent('nmap not detected');
    });
  });
});
