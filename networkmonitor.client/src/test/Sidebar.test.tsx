/**
 * Sidebar: active-route highlighting, group structure, and the
 * unacknowledged-alert badge fed by the AlertCount context.
 */
import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Sidebar from '../Components/Sidebar/Sidebar';
import { AlertCountProvider } from '../context/AlertCountContext';
import { mockFetchRoutes } from './mockFetch';

function renderSidebar(route: string) {
  mockFetchRoutes({
    '/api/alerts': { items: [], page: 1, pageSize: 1, total: 7, totalPages: 7 },
    '/api/settings/system': {
      version: '1.0.0',
      nmapAvailable: true,
      nmapVersion: '7.95',
      schedulerEnabled: true,
      provider: 'Sqlite',
      demoMode: true,
      companyName: 'NetworkMonitor',
    },
  });
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AlertCountProvider>
        <Sidebar open={false} onClose={() => {}} />
      </AlertCountProvider>
    </MemoryRouter>,
  );
}

describe('Sidebar', () => {
  it('marks the link for the current route active', () => {
    renderSidebar('/devices');
    expect(screen.getByTestId('nav-link-devices')).toHaveClass('active');
    expect(screen.getByTestId('nav-link-dashboard')).not.toHaveClass('active');
  });

  it('does not mark Dashboard active on other routes (end matching)', () => {
    renderSidebar('/alerts');
    expect(screen.getByTestId('nav-link-dashboard')).not.toHaveClass('active');
    expect(screen.getByTestId('nav-link-alerts')).toHaveClass('active');
  });

  it('renders all five navigation groups', () => {
    renderSidebar('/');
    for (const group of ['overview', 'inventory', 'security', 'network', 'admin']) {
      expect(screen.getByTestId(`nav-group-${group}`)).toBeInTheDocument();
    }
  });

  it('shows the unacknowledged alert count as a badge', async () => {
    renderSidebar('/');
    await waitFor(() => {
      expect(screen.getByTestId('sidebar-alert-badge')).toHaveTextContent('7');
    });
  });

  it('shows the product name and version footer', async () => {
    renderSidebar('/');
    expect(screen.getByAltText('NetworkMonitor')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('sidebar-version')).toHaveTextContent('v1.0.0');
    });
  });
});
