/**
 * Vulnerability triage: CVSS-sorted table with severity/status filters,
 * free-text search, and inline status changes (open / remediated /
 * accepted_risk) — the three-way outcome every finding eventually gets.
 * CVE ids link out to the NVD entry for the full write-up.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, buildQuery } from '../../services/api';
import { useAsync } from '../../hooks/useAsync';
import type { Paged, Vulnerability, VulnerabilityStatus } from '../../types';
import { formatDate } from '../../utils/format';
import DataTable from '../Shared/DataTable';
import type { Column } from '../Shared/DataTable';
import Pagination from '../Shared/Pagination';
import SeverityBadge from '../Shared/SeverityBadge';
import ErrorBanner from '../Shared/ErrorBanner';
import './Vulnerabilities.css';

const PAGE_SIZE = 25;
const STATUSES: VulnerabilityStatus[] = ['open', 'remediated', 'accepted_risk'];

/** CVSS score → the band CVSS v3 defines, for the score chip color. */
function cvssBand(score: number | null): string {
  if (score === null) return 'none';
  if (score >= 9) return 'critical';
  if (score >= 7) return 'high';
  if (score >= 4) return 'medium';
  return 'low';
}

export default function Vulnerabilities() {
  const navigate = useNavigate();
  const [severity, setSeverity] = useState('');
  const [status, setStatus] = useState('open');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [mutError, setMutError] = useState<string | null>(null);
  const [changingId, setChangingId] = useState<number | null>(null);

  const query = buildQuery({ severity, status, search, page, pageSize: PAGE_SIZE });
  const vulns = useAsync<Paged<Vulnerability>>(
    () => api.get<Paged<Vulnerability>>(`/api/vulnerabilities${query}`),
    [query],
  );

  const changeStatus = async (vuln: Vulnerability, next: string) => {
    setChangingId(vuln.id);
    setMutError(null);
    try {
      await api.put(`/api/vulnerabilities/${vuln.id}/status`, { status: next });
      vulns.reload();
    } catch (err) {
      setMutError(err instanceof Error ? err.message : 'Status change failed');
    } finally {
      setChangingId(null);
    }
  };

  const columns = useMemo<Column<Vulnerability>[]>(
    () => [
      {
        key: 'cvssScore',
        header: 'CVSS',
        sortable: true,
        sortValue: (v) => v.cvssScore,
        render: (v) => (
          <span className={`cvss-chip cvss-${cvssBand(v.cvssScore)}`}>
            {v.cvssScore != null ? v.cvssScore.toFixed(1) : '—'}
          </span>
        ),
      },
      { key: 'severity', header: 'Severity', sortable: true, render: (v) => <SeverityBadge severity={v.severity} /> },
      {
        key: 'cveId',
        header: 'CVE',
        sortable: true,
        render: (v) => (
          <a
            href={`https://nvd.nist.gov/vuln/detail/${encodeURIComponent(v.cveId)}`}
            target="_blank"
            rel="noreferrer"
            className="mono"
            onClick={(e) => e.stopPropagation()}
          >
            {v.cveId}
            <i className="bi bi-box-arrow-up-right ms-1 small" />
          </a>
        ),
      },
      {
        key: 'device',
        header: 'Device',
        render: (v) => (
          <span className="cell-primary cell-mono">
            {v.deviceIp ?? `#${v.deviceId}`}
            {v.deviceHostname && <span className="text-muted-token"> · {v.deviceHostname}</span>}
          </span>
        ),
      },
      {
        key: 'affectedService',
        header: 'Service',
        render: (v) => (
          <span>
            {v.affectedService ?? '—'}
            {v.portNumber != null && <span className="text-muted-token"> :{v.portNumber}</span>}
          </span>
        ),
      },
      { key: 'detectedAt', header: 'Detected', sortable: true, render: (v) => formatDate(v.detectedAt) },
      {
        key: 'status',
        header: 'Status',
        render: (v) => (
          <select
            className="form-select form-select-sm status-select"
            value={v.status}
            disabled={changingId === v.id}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => changeStatus(v, e.target.value)}
            aria-label={`Status for ${v.cveId}`}
            data-testid={`vuln-status-${v.id}`}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s.replace('_', ' ')}</option>
            ))}
          </select>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [changingId],
  );

  return (
    <div data-testid="vulnerabilities-page">
      {(vulns.error || mutError) && (
        <ErrorBanner
          message={vulns.error ?? mutError ?? ''}
          onRetry={vulns.error ? vulns.reload : undefined}
          onDismiss={mutError ? () => setMutError(null) : undefined}
        />
      )}

      <div className="filter-row">
        <input
          type="search"
          className="form-control vuln-search"
          placeholder="Search CVE, service, device…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          data-testid="vuln-search"
        />
        <select className="form-select" value={severity}
          onChange={(e) => { setSeverity(e.target.value); setPage(1); }} aria-label="Filter by severity">
          <option value="">Any severity</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <select className="form-select" value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Filter by status" data-testid="vuln-status-filter">
          <option value="">Any status</option>
          <option value="open">Open</option>
          <option value="remediated">Remediated</option>
          <option value="accepted_risk">Accepted risk</option>
        </select>
      </div>

      <div className="nm-card" data-tour="vuln-table">
        <DataTable
          columns={columns}
          rows={vulns.data?.items ?? []}
          rowKey={(v) => v.id}
          loading={vulns.loading}
          onRowClick={(v) => navigate(`/devices/${v.deviceId}`)}
          defaultSort={{ key: 'cvssScore', dir: 'desc' }}
          emptyTitle="No vulnerabilities match"
          emptyMessage={status === 'open' ? 'Nothing open — either you patched everything or the security profile hasn’t run yet.' : 'Try widening the filters.'}
          emptyIcon="bi-shield-check"
          testId="vulns-table"
        />
        {vulns.data && (
          <Pagination
            page={vulns.data.page}
            totalPages={vulns.data.totalPages}
            total={vulns.data.total}
            onPageChange={setPage}
            noun="finding"
          />
        )}
      </div>
    </div>
  );
}
