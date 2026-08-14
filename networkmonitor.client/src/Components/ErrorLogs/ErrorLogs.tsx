/**
 * Error Logs: one screen for every failure in the system, from either tier.
 *
 * Server entries arrive from the exception middleware and the database logger
 * provider; browser entries are posted by services/errorLogger.ts. Because the
 * two share a table, an incident that started as a 500 and ended as a broken
 * page shows up as two rows carrying the same correlation id — which is why
 * the detail panel puts that id behind a copy button rather than burying it.
 *
 * The table is hand-rolled rather than built on DataTable: rows expand into an
 * inline detail panel, and a stack trace belongs directly under the row it
 * explains, not in a side drawer that loses its place when the list refreshes.
 */
import { useEffect, useState } from 'react';
import { api, buildQuery } from '../../services/api';
import { useAsync } from '../../hooks/useAsync';
import type {
  ErrorLogEntry,
  ErrorLogPurgeResult,
  ErrorLogSummary,
  Paged,
} from '../../types';
import { ERROR_LOG_LEVELS } from '../../types';
import { formatDateTime, formatNumber, humanize, relativeTime } from '../../utils/format';
import Pagination from '../Shared/Pagination';
import StatCard from '../Shared/StatCard';
import EmptyState from '../Shared/EmptyState';
import ErrorBanner from '../Shared/ErrorBanner';
import LoadingSpinner from '../Shared/LoadingSpinner';
import ConfirmDialog from '../Shared/ConfirmDialog';
import './ErrorLogs.css';

const PAGE_SIZE = 25;

/** Search waits this long after the last keystroke before hitting the API. */
const SEARCH_DEBOUNCE_MS = 300;

/** Matches the retention the API documents as its default purge window. */
const DEFAULT_PURGE_DAYS = 30;

/** Column count, kept in one place so the detail row's colSpan can't drift. */
const COLUMN_COUNT = 6;

/** Level → badge modifier. Unknown levels fall back to a neutral chip. */
function levelClass(level: string): string {
  const key = level.toLowerCase();
  return key === 'fatal' || key === 'error' || key === 'warning' || key === 'info'
    ? ` lvl-${key}`
    : '';
}

/** Truncates a message for the table cell; the full text lives in the panel. */
function truncate(value: string, max = 140): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/**
 * Keeps the search box's raw text and the debounced query as two separate
 * pieces of state on purpose: only the debounced one is a fetch dependency, so
 * typing re-renders the input without re-running the request.
 *
 * `expandedId` allows one open detail panel at a time, and it is not cleared
 * when the list reloads — an id that is no longer on the page simply matches
 * nothing, so a background refresh cannot collapse the trace you are reading.
 *
 * An empty table here is the correct, healthy state, which is why the page
 * leads with summary tiles rather than with the list.
 */
export default function ErrorLogs() {
  const [source, setSource] = useState('');
  const [level, setLevel] = useState('');
  const [resolved, setResolved] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [mutError, setMutError] = useState<string | null>(null);

  const [purgeDays, setPurgeDays] = useState(DEFAULT_PURGE_DAYS);
  const [confirmPurge, setConfirmPurge] = useState(false);
  const [purgeBusy, setPurgeBusy] = useState(false);
  const [purgeNotice, setPurgeNotice] = useState<string | null>(null);

  // Debounce: typing a stack-trace fragment shouldn't fire a query per
  // character against a table that is, by design, the largest one we have.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const query = buildQuery({ source, level, search, resolved, page, pageSize: PAGE_SIZE });
  const logs = useAsync<Paged<ErrorLogEntry>>(
    () => api.get<Paged<ErrorLogEntry>>(`/api/logs${query}`),
    [query],
  );
  const summary = useAsync<ErrorLogSummary>(() => api.get<ErrorLogSummary>('/api/logs/summary'), []);

  const filtered = source !== '' || level !== '' || resolved !== '' || search !== '';

  /** Reloads both the page of rows and the tiles that count them. */
  const reloadAll = () => {
    logs.reload();
    summary.reload();
  };

  const setResolvedState = async (entry: ErrorLogEntry, isResolved: boolean) => {
    setBusyId(entry.id);
    setMutError(null);
    try {
      await api.put(`/api/logs/${entry.id}/resolved`, { isResolved });
      reloadAll();
    } catch (err) {
      setMutError(err instanceof Error ? err.message : 'Could not update the entry');
    } finally {
      setBusyId(null);
    }
  };

  const purge = async () => {
    setPurgeBusy(true);
    setMutError(null);
    try {
      const result = await api.del<ErrorLogPurgeResult>(`/api/logs?olderThanDays=${purgeDays}`);
      setConfirmPurge(false);
      setPurgeNotice(`Removed ${formatNumber(result?.removed ?? 0)} entries older than ${purgeDays} days.`);
      setExpandedId(null);
      setPage(1);
      reloadAll();
    } catch (err) {
      setMutError(err instanceof Error ? err.message : 'Purge failed');
    } finally {
      setPurgeBusy(false);
    }
  };

  /** Clipboard is unavailable over plain HTTP and in some embedded views. */
  const copyCorrelationId = async (entry: ErrorLogEntry) => {
    if (!entry.correlationId) return;
    try {
      await navigator.clipboard?.writeText(entry.correlationId);
      setCopiedId(entry.id);
      setTimeout(() => setCopiedId((current) => (current === entry.id ? null : current)), 1_500);
    } catch {
      // Copying is a convenience — the id is on screen and selectable anyway.
    }
  };

  const rows = logs.data?.items ?? [];

  return (
    <div data-testid="error-logs-page">
      <div className="page-title-row">
        <div>
          <h2>Activity &amp; Error Logs</h2>
          <div className="page-subtitle">
            What the application is doing, and everything that has failed on either
            tier — newest first. Server activity and failures arrive through the
            standard logging pipeline; browser errors are reported back by the client.
          </div>
        </div>
        <div className="purge-control">
          <label className="form-label mb-0" htmlFor="purge-days">
            Purge older than
          </label>
          <input
            id="purge-days"
            type="number"
            className="form-control"
            min={1}
            max={365}
            value={purgeDays}
            onChange={(e) => setPurgeDays(Math.max(1, Number(e.target.value) || 1))}
            data-testid="purge-days"
          />
          <span className="text-muted-token">days</span>
          <button
            type="button"
            className="btn btn-danger-soft"
            onClick={() => setConfirmPurge(true)}
            data-testid="purge-button"
          >
            <i className="bi bi-trash3 me-1" />
            Purge
          </button>
        </div>
      </div>

      {(logs.error || mutError) && (
        <ErrorBanner
          message={logs.error ?? mutError ?? ''}
          onRetry={logs.error ? logs.reload : undefined}
          onDismiss={mutError ? () => setMutError(null) : undefined}
        />
      )}

      {purgeNotice && (
        <div className="warn-banner" data-testid="purge-notice">
          <i className="bi bi-info-circle-fill" />
          <div className="flex-grow-1">{purgeNotice}</div>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => setPurgeNotice(null)}
            aria-label="Dismiss"
          >
            <i className="bi bi-x-lg" />
          </button>
        </div>
      )}

      <div className="error-log-stats" data-testid="error-log-stats" data-tour="error-log-stats">
        <StatCard
          icon="bi-journal-text"
          label="Total logged"
          value={formatNumber(summary.data?.total ?? 0)}
          tone="accent"
          testId="stat-log-total"
        />
        <StatCard
          icon="bi-clock-history"
          label="Last 24 hours"
          value={formatNumber(summary.data?.last24Hours ?? 0)}
          tone={(summary.data?.last24Hours ?? 0) > 0 ? 'warning' : 'success'}
          testId="stat-log-24h"
        />
        <StatCard
          icon="bi-hdd-rack"
          label="Server"
          value={formatNumber(summary.data?.serverErrors ?? 0)}
          tone="info"
          testId="stat-log-server"
        />
        <StatCard
          icon="bi-window"
          label="Browser"
          value={formatNumber(summary.data?.clientErrors ?? 0)}
          tone="info"
          testId="stat-log-client"
        />
        <StatCard
          icon="bi-inbox"
          label="Unresolved"
          value={formatNumber(summary.data?.unresolved ?? 0)}
          tone={(summary.data?.unresolved ?? 0) > 0 ? 'error' : 'success'}
          testId="stat-log-unresolved"
        />
      </div>

      <div className="filter-row">
        <input
          type="search"
          className="form-control log-search"
          placeholder="Search message, type, path…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          aria-label="Search error logs"
          data-testid="error-log-search"
        />
        <select
          className="form-select"
          value={source}
          onChange={(e) => { setSource(e.target.value); setPage(1); }}
          aria-label="Filter by source"
          data-testid="filter-source"
        >
          <option value="">Any source</option>
          <option value="server">Server</option>
          <option value="client">Browser</option>
        </select>
        <select
          className="form-select"
          value={level}
          onChange={(e) => { setLevel(e.target.value); setPage(1); }}
          aria-label="Filter by level"
          data-testid="filter-level"
        >
          <option value="">Any level</option>
          {ERROR_LOG_LEVELS.map((l) => (
            <option key={l} value={l}>{humanize(l)}</option>
          ))}
        </select>
        <select
          className="form-select"
          value={resolved}
          onChange={(e) => { setResolved(e.target.value); setPage(1); }}
          aria-label="Filter by resolved state"
          data-testid="filter-resolved"
        >
          <option value="">Any state</option>
          <option value="false">Unresolved</option>
          <option value="true">Resolved</option>
        </select>
      </div>

      <div className="nm-card">
        <div className="nm-table-wrap">
          <table className="nm-table error-log-table" data-testid="error-log-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Source</th>
                <th>Level</th>
                <th>Message</th>
                <th>Path</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {logs.loading ? (
                <tr>
                  <td colSpan={COLUMN_COUNT}>
                    <LoadingSpinner label="Loading…" />
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={COLUMN_COUNT}>
                    {/* An empty error log is the goal state, not a failure —
                        the copy says so instead of showing a sad shrug. */}
                    <EmptyState
                      icon={filtered ? 'bi-funnel' : 'bi-emoji-smile'}
                      title={filtered ? 'No entries match these filters' : 'No errors logged'}
                      message={
                        filtered
                          ? 'Try widening the filters or clearing the search.'
                          : 'Nothing has failed on either tier. That is exactly what this page should look like.'
                      }
                    />
                  </td>
                </tr>
              ) : (
                rows.map((entry) => {
                  const expanded = expandedId === entry.id;
                  return [
                    <tr
                      key={entry.id}
                      className={`clickable${entry.isResolved ? ' row-resolved' : ''}`}
                      onClick={() => setExpandedId(expanded ? null : entry.id)}
                      aria-expanded={expanded}
                      data-testid="error-log-row"
                    >
                      <td>
                        <span title={formatDateTime(entry.occurredAt)}>{relativeTime(entry.occurredAt)}</span>
                      </td>
                      <td>
                        <span className={`log-source src-${entry.source.toLowerCase()}`}>
                          <i className={`bi ${entry.source === 'client' ? 'bi-window' : 'bi-hdd-rack'}`} />
                          {entry.source === 'client' ? 'Browser' : 'Server'}
                        </span>
                      </td>
                      <td>
                        <span className={`log-level${levelClass(entry.level)}`} data-testid="error-log-level">
                          {humanize(entry.level)}
                        </span>
                      </td>
                      <td className="log-message-cell">
                        <span className="cell-primary">{truncate(entry.message)}</span>
                        {entry.exceptionType && (
                          <span className="log-exception-type">{entry.exceptionType}</span>
                        )}
                      </td>
                      <td className="cell-mono log-path">{entry.path ?? '—'}</td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          disabled={busyId === entry.id}
                          onClick={(e) => {
                            e.stopPropagation(); // the row click expands; this must not
                            setResolvedState(entry, !entry.isResolved);
                          }}
                          data-testid={`resolve-${entry.id}`}
                        >
                          {busyId === entry.id ? '…' : entry.isResolved ? 'Reopen' : 'Mark resolved'}
                        </button>
                      </td>
                    </tr>,
                    expanded ? (
                      <tr key={`${entry.id}-detail`} className="detail-row">
                        <td colSpan={COLUMN_COUNT}>
                          <div className="error-log-detail" data-testid="error-log-detail">
                            <div className="detail-message">{entry.message}</div>

                            <dl className="detail-facts">
                              <div>
                                <dt>Exception type</dt>
                                <dd className="mono">{entry.exceptionType ?? '—'}</dd>
                              </div>
                              <div>
                                <dt>Occurred</dt>
                                <dd>{formatDateTime(entry.occurredAt)}</dd>
                              </div>
                              <div>
                                <dt>Request</dt>
                                <dd className="mono">
                                  {[entry.method, entry.path].filter(Boolean).join(' ') || '—'}
                                  {entry.statusCode != null && ` · ${entry.statusCode}`}
                                </dd>
                              </div>
                              <div>
                                <dt>User agent</dt>
                                <dd className="detail-agent">{entry.userAgent ?? '—'}</dd>
                              </div>
                              <div>
                                <dt>Correlation id</dt>
                                <dd className="detail-correlation">
                                  <span className="mono">{entry.correlationId ?? '—'}</span>
                                  {entry.correlationId && (
                                    <button
                                      type="button"
                                      className="btn btn-sm btn-ghost"
                                      onClick={() => copyCorrelationId(entry)}
                                      aria-label="Copy correlation id"
                                      data-testid={`copy-correlation-${entry.id}`}
                                    >
                                      <i className={`bi ${copiedId === entry.id ? 'bi-check2' : 'bi-clipboard'}`} />
                                      {copiedId === entry.id ? ' Copied' : ' Copy'}
                                    </button>
                                  )}
                                </dd>
                              </div>
                            </dl>

                            <div className="detail-stack-label">Stack trace</div>
                            <pre className="detail-stack" data-testid="error-log-stack">
                              {entry.stackTrace ?? 'No stack trace was captured for this entry.'}
                            </pre>
                          </div>
                        </td>
                      </tr>
                    ) : null,
                  ];
                })
              )}
            </tbody>
          </table>
        </div>
        {logs.data && (
          <Pagination
            page={logs.data.page}
            totalPages={logs.data.totalPages}
            total={logs.data.total}
            onPageChange={(next) => { setPage(next); setExpandedId(null); }}
            noun="record"
          />
        )}
      </div>

      <ConfirmDialog
        open={confirmPurge}
        title={`Purge entries older than ${purgeDays} days?`}
        message="Deleted entries cannot be recovered. Resolved and unresolved entries are both removed."
        confirmLabel="Purge entries"
        danger
        busy={purgeBusy}
        onConfirm={purge}
        onCancel={() => setConfirmPurge(false)}
      />
    </div>
  );
}
