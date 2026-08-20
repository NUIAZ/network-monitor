/**
 * Scan history + on-demand scan runner.
 *
 * The run panel POSTs /api/scans/run and *waits*: the endpoint executes a
 * real nmap scan synchronously and returns the completed result, which can
 * take a while on a deep profile. The button therefore shows a live spinner
 * with the elapsed time, and the 503 nmap-missing case gets its own warning
 * (that's a server configuration problem, not a scan failure).
 */
import { useEffect, useMemo, useState } from 'react';
import { api, buildQuery, ApiError } from '../../services/api';
import { useAsync } from '../../hooks/useAsync';
import type { NetworkInfo, Paged, ScanProfileDefinition, ScanResult } from '../../types';
import { formatDateTime, formatDuration, humanize } from '../../utils/format';
import DataTable from '../Shared/DataTable';
import type { Column } from '../Shared/DataTable';
import Pagination from '../Shared/Pagination';
import StatusPill from '../Shared/StatusPill';
import ErrorBanner from '../Shared/ErrorBanner';
import LoadingSpinner from '../Shared/LoadingSpinner';
import './ScanHistory.css';

const PAGE_SIZE = 20;

/** Duration column: prefer the server's number, else derive from timestamps. */
function scanDuration(scan: ScanResult): string {
  if (scan.durationSeconds != null) return formatDuration(scan.durationSeconds);
  if (scan.completedAt) {
    const seconds = (new Date(scan.completedAt).getTime() - new Date(scan.startedAt).getTime()) / 1000;
    return formatDuration(seconds);
  }
  return scan.status === 'running' ? 'running…' : '-';
}

/**
 * Two features sharing a screen, and the run panel is the awkward half: because
 * the run endpoint blocks until nmap exits, `running` can stay true for minutes
 * and there is no way to cancel it; navigating away abandons the request but
 * not the scan, which finishes server-side and shows up in the table on return.
 *
 * The elapsed-seconds ticker exists purely so a long profile does not look
 * hung; it is display state and has no bearing on the request.
 */
export default function ScanHistory() {
  const [page, setPage] = useState(1);
  const [networkFilter, setNetworkFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Run-panel state.
  const [runNetworkId, setRunNetworkId] = useState('');
  const [runProfile, setRunProfile] = useState('quick');
  const [running, setRunning] = useState(false);
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [runError, setRunError] = useState<string | null>(null);
  const [nmapMissing, setNmapMissing] = useState(false);
  const [runResult, setRunResult] = useState<ScanResult | null>(null);

  const networks = useAsync<NetworkInfo[]>(() => api.get<NetworkInfo[]>('/api/networks'), []);
  const profiles = useAsync<ScanProfileDefinition[]>(
    () => api.get<ScanProfileDefinition[]>('/api/scans/profiles'),
    [],
  );

  const query = buildQuery({ networkId: networkFilter, status: statusFilter, page, pageSize: PAGE_SIZE });
  const scans = useAsync<Paged<ScanResult>>(() => api.get<Paged<ScanResult>>(`/api/scans${query}`), [query]);

  // Elapsed-time ticker while a scan runs, so the panel visibly isn't hung.
  useEffect(() => {
    if (!running || runStartedAt === null) return;
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - runStartedAt) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [running, runStartedAt]);

  const selectedProfile = (profiles.data ?? []).find((p) => p.profileType === runProfile);

  const runScan = async () => {
    if (!runNetworkId) return;
    setRunning(true);
    setRunStartedAt(Date.now());
    setElapsed(0);
    setRunError(null);
    setNmapMissing(false);
    setRunResult(null);
    try {
      const result = await api.post<ScanResult>('/api/scans/run', {
        networkId: Number(runNetworkId),
        profileType: runProfile,
      });
      setRunResult(result);
      setPage(1);
      scans.reload();
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) {
        // nmap isn't installed server-side: a setup problem, not a failure
        // of this particular scan, so it gets distinct messaging.
        setNmapMissing(true);
      } else {
        setRunError(err instanceof Error ? err.message : 'Scan failed');
      }
    } finally {
      setRunning(false);
    }
  };

  const columns = useMemo<Column<ScanResult>[]>(
    () => [
      { key: 'startedAt', header: 'Started', render: (s) => formatDateTime(s.startedAt) },
      {
        key: 'network',
        header: 'Network',
        render: (s) => (
          <span className="cell-primary">
            {s.networkName ?? `#${s.networkId}`}
            {s.siteName && <span className="text-muted-token"> · {s.siteName}</span>}
          </span>
        ),
      },
      { key: 'scanType', header: 'Profile', render: (s) => <span className="profile-chip">{humanize(s.scanType)}</span> },
      { key: 'duration', header: 'Duration', render: scanDuration },
      { key: 'hostsUp', header: 'Hosts up' },
      { key: 'hostsDown', header: 'Hosts down' },
      {
        key: 'newDevices',
        header: 'New devices',
        render: (s) => (s.newDevices > 0 ? <strong className="new-devices">+{s.newDevices}</strong> : '0'),
      },
      {
        key: 'status',
        header: 'Status',
        render: (s) => (
          <span className="d-inline-flex align-items-center gap-2">
            <StatusPill status={s.status} />
            {s.failureReason && (
              <i className="bi bi-info-circle text-muted-token" title={s.failureReason} data-testid="failure-reason" />
            )}
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <div data-testid="scan-history-page">
      {/* ---- run panel ---- */}
      <div className="nm-card run-panel mb-3">
        <div className="nm-card-header">
          Run a scan now
          <i className="bi bi-play-circle" />
        </div>
        <div className="nm-card-body">
          {nmapMissing && (
            <div className="warn-banner" data-testid="nmap-missing-banner">
              <i className="bi bi-exclamation-triangle-fill" />
              <div>
                <strong>nmap is not installed on the server</strong>; on-demand scans can't run.
                Install nmap on the API host and it will be picked up automatically.
              </div>
            </div>
          )}
          {runError && <ErrorBanner message={runError} onDismiss={() => setRunError(null)} />}
          {runResult && (
            <div className="run-result" data-testid="run-result">
              <i className={`bi ${runResult.status === 'completed' ? 'bi-check-circle-fill ok' : 'bi-x-circle-fill bad'}`} />
              <span>
                Scan {runResult.status}: <strong>{runResult.hostsUp}</strong> hosts up,{' '}
                <strong>{runResult.hostsDown}</strong> down
                {runResult.newDevices > 0 && <>, <strong>+{runResult.newDevices} new</strong></>}
                {runResult.failureReason && <>: {runResult.failureReason}</>}
              </span>
            </div>
          )}
          <div className="run-controls">
            <div>
              <label className="form-label" htmlFor="run-network">Network</label>
              <select id="run-network" className="form-select" value={runNetworkId}
                onChange={(e) => setRunNetworkId(e.target.value)} disabled={running} data-testid="run-network">
                <option value="">Choose a network…</option>
                {(networks.data ?? []).map((n) => (
                  <option key={n.id} value={n.id}>{n.name} · {n.cidr}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label" htmlFor="run-profile">Profile</label>
              <select id="run-profile" className="form-select" value={runProfile}
                onChange={(e) => setRunProfile(e.target.value)} disabled={running} data-testid="run-profile">
                {(profiles.data ?? [{ profileType: 'quick' }, { profileType: 'deep' }]).map((p) => (
                  <option key={p.profileType} value={p.profileType}>{humanize(p.name ?? p.profileType)}</option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="btn btn-accent run-button"
              onClick={runScan}
              disabled={running || !runNetworkId}
              data-testid="run-scan"
            >
              {running ? (
                <span className="d-inline-flex align-items-center gap-2">
                  <LoadingSpinner size="sm" /> Scanning… {formatDuration(elapsed)}
                </span>
              ) : (
                <span><i className="bi bi-play-fill me-1" />Run scan</span>
              )}
            </button>
          </div>
          {selectedProfile?.description && (
            <div className="form-text mt-2">{selectedProfile.description}</div>
          )}
          {selectedProfile?.nmapArgs && (
            <div className="form-text mono">nmap {selectedProfile.nmapArgs}</div>
          )}
        </div>
      </div>

      {/* ---- history table ---- */}
      {scans.error && <ErrorBanner message={scans.error} onRetry={scans.reload} />}

      <div className="filter-row">
        <select className="form-select" value={networkFilter}
          onChange={(e) => { setNetworkFilter(e.target.value); setPage(1); }} aria-label="Filter by network">
          <option value="">All networks</option>
          {(networks.data ?? []).map((n) => (
            <option key={n.id} value={n.id}>{n.name}</option>
          ))}
        </select>
        <select className="form-select" value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} aria-label="Filter by status">
          <option value="">Any status</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
          <option value="running">Running</option>
        </select>
      </div>

      <div className="nm-card">
        <DataTable
          columns={columns}
          rows={scans.data?.items ?? []}
          rowKey={(s) => s.id}
          loading={scans.loading}
          emptyTitle="No scans recorded"
          emptyMessage="Run a scan above, or enable the scheduler to scan on a cadence."
          emptyIcon="bi-clock-history"
          testId="scan-table"
        />
        {scans.data && (
          <Pagination
            page={scans.data.page}
            totalPages={scans.data.totalPages}
            total={scans.data.total}
            onPageChange={setPage}
            noun="scan"
          />
        )}
      </div>
    </div>
  );
}
