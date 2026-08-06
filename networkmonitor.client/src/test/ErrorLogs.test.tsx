/**
 * Error Logs page against a mocked API: the tiles, the rows and their badges,
 * the inline detail panel, the resolve action, and the deliberately cheerful
 * empty state (an empty error log is the goal, not a failure).
 */
import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import ErrorLogs from '../Components/ErrorLogs/ErrorLogs';
import type { ErrorLogEntry } from '../types';
import { mockFetchRoutes } from './mockFetch';

const SERVER_ENTRY: ErrorLogEntry = {
  id: 11,
  source: 'server',
  level: 'error',
  message: 'Sequence contains no elements',
  exceptionType: 'InvalidOperationException',
  stackTrace: 'at NetworkMonitor.Server.Controllers.DevicesController.Get(Int32 id)',
  path: '/api/devices/9',
  method: 'GET',
  statusCode: 500,
  userAgent: null,
  correlationId: 'c0rr-1234',
  occurredAt: '2026-08-05T11:00:00Z',
  isResolved: false,
};

const CLIENT_ENTRY: ErrorLogEntry = {
  id: 12,
  source: 'client',
  level: 'fatal',
  message: 'Cannot read properties of undefined (reading "items")',
  exceptionType: 'TypeError',
  stackTrace: 'TypeError: ...\n  at DeviceList',
  path: '/devices',
  method: null,
  statusCode: null,
  userAgent: 'Mozilla/5.0 (Test Runner)',
  correlationId: null,
  occurredAt: '2026-08-05T10:00:00Z',
  isResolved: true,
};

/** Summary first: the list key '/api/logs' would otherwise swallow its URL. */
function mockLogs(items: ErrorLogEntry[]) {
  return mockFetchRoutes({
    '/api/logs/summary': { total: 42, last24Hours: 5, serverErrors: 30, clientErrors: 12, unresolved: 7 },
    '/api/logs': { items, page: 1, pageSize: 25, total: items.length, totalPages: 1 },
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ErrorLogs />
    </MemoryRouter>,
  );
}

describe('ErrorLogs', () => {
  it('renders the summary tiles from /api/logs/summary', async () => {
    mockLogs([SERVER_ENTRY, CLIENT_ENTRY]);
    renderPage();

    await waitFor(() => expect(screen.getByTestId('stat-log-total-value')).toHaveTextContent('42'));
    expect(screen.getByTestId('stat-log-24h-value')).toHaveTextContent('5');
    expect(screen.getByTestId('stat-log-server-value')).toHaveTextContent('30');
    expect(screen.getByTestId('stat-log-client-value')).toHaveTextContent('12');
    expect(screen.getByTestId('stat-log-unresolved-value')).toHaveTextContent('7');
  });

  it('renders one row per entry with its source and level badges', async () => {
    mockLogs([SERVER_ENTRY, CLIENT_ENTRY]);
    renderPage();

    await waitFor(() => expect(screen.getAllByTestId('error-log-row')).toHaveLength(2));
    const rows = screen.getAllByTestId('error-log-row');

    expect(rows[0]).toHaveTextContent('Sequence contains no elements');
    expect(rows[0]).toHaveTextContent('Server');
    expect(within(rows[0]).getByTestId('error-log-level')).toHaveTextContent('Error');

    expect(rows[1]).toHaveTextContent('Browser');
    expect(within(rows[1]).getByTestId('error-log-level')).toHaveTextContent('Fatal');
  });

  it('shows a good-news empty state when nothing has been logged', async () => {
    mockLogs([]);
    renderPage();

    await waitFor(() => expect(screen.getByTestId('empty-state')).toBeInTheDocument());
    expect(screen.getByTestId('empty-state')).toHaveTextContent('No errors logged');
    expect(screen.queryByTestId('error-log-row')).toBeNull();
  });

  it('expands an inline detail panel with the stack trace and correlation id', async () => {
    const user = userEvent.setup();
    mockLogs([SERVER_ENTRY]);
    renderPage();

    await waitFor(() => expect(screen.getAllByTestId('error-log-row')).toHaveLength(1));
    expect(screen.queryByTestId('error-log-detail')).toBeNull();

    await user.click(screen.getAllByTestId('error-log-row')[0]);

    const detail = screen.getByTestId('error-log-detail');
    expect(detail).toHaveTextContent('InvalidOperationException');
    expect(detail).toHaveTextContent('GET /api/devices/9');
    expect(detail).toHaveTextContent('c0rr-1234');
    expect(screen.getByTestId('error-log-stack')).toHaveTextContent('DevicesController.Get');
    expect(screen.getByTestId('copy-correlation-11')).toBeInTheDocument();

    // Clicking the same row again collapses it.
    await user.click(screen.getAllByTestId('error-log-row')[0]);
    expect(screen.queryByTestId('error-log-detail')).toBeNull();
  });

  it('marks an entry resolved without expanding the row', async () => {
    const user = userEvent.setup();
    const fetchMock = mockLogs([SERVER_ENTRY]);
    renderPage();

    await waitFor(() => expect(screen.getByTestId('resolve-11')).toBeInTheDocument());
    await user.click(screen.getByTestId('resolve-11'));

    await waitFor(() => {
      const put = fetchMock.mock.calls.find(
        (call) => (call[1] as RequestInit | undefined)?.method === 'PUT',
      );
      expect(put).toBeDefined();
      expect(put?.[0]).toBe('/api/logs/11/resolved');
      expect(JSON.parse((put?.[1] as RequestInit).body as string)).toEqual({ isResolved: true });
    });
    // The row action must not have opened the detail panel.
    expect(screen.queryByTestId('error-log-detail')).toBeNull();
  });

  it('purges old entries only after the confirm dialog is accepted', async () => {
    const user = userEvent.setup();
    const fetchMock = mockLogs([SERVER_ENTRY]);
    renderPage();

    await waitFor(() => expect(screen.getByTestId('purge-button')).toBeInTheDocument());
    await user.click(screen.getByTestId('purge-button'));

    expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === 'DELETE')).toBe(false);

    await user.click(screen.getByTestId('confirm-accept'));

    await waitFor(() => {
      const del = fetchMock.mock.calls.find(
        (call) => (call[1] as RequestInit | undefined)?.method === 'DELETE',
      );
      expect(del?.[0]).toBe('/api/logs?olderThanDays=30');
    });
  });

  it('debounces the search box into a single filtered request', async () => {
    const user = userEvent.setup();
    const fetchMock = mockLogs([SERVER_ENTRY]);
    renderPage();

    await waitFor(() => expect(screen.getAllByTestId('error-log-row')).toHaveLength(1));
    await user.type(screen.getByTestId('error-log-search'), 'timeout');

    await waitFor(() => {
      const searched = fetchMock.mock.calls.filter((call) => String(call[0]).includes('search=timeout'));
      expect(searched).toHaveLength(1);
    });
  });
});
