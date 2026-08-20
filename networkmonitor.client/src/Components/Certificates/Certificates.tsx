/**
 * TLS certificate inventory, sorted by time-to-expiry because that's the only
 * order that matters for this screen: the certificate that expires next
 * belongs on top. Days-until-expiry is color-banded (expired red, <30d
 * amber) and the filter narrows to the common horizons.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, buildQuery } from '../../services/api';
import { useAsync } from '../../hooks/useAsync';
import type { Paged, SslCertificate } from '../../types';
import { formatDate } from '../../utils/format';
import DataTable from '../Shared/DataTable';
import type { Column } from '../Shared/DataTable';
import Pagination from '../Shared/Pagination';
import ErrorBanner from '../Shared/ErrorBanner';
import './Certificates.css';

const PAGE_SIZE = 25;

/**
 * Derives days-until-expiry client-side when the API row didn't carry it;
 * the number drives the entire page, so it must always exist.
 */
function daysLeft(cert: SslCertificate): number | null {
  if (cert.daysUntilExpiry !== undefined) return cert.daysUntilExpiry;
  if (!cert.validTo) return null;
  return Math.floor((new Date(cert.validTo).getTime() - Date.now()) / 86_400_000);
}

function ExpiryCell({ cert }: { cert: SslCertificate }) {
  const days = daysLeft(cert);
  if (days === null) return <span className="text-muted-token">-</span>;
  if (days < 0) {
    return (
      <span className="expiry expired" data-testid="expiry-expired">
        <i className="bi bi-x-octagon-fill me-1" />
        expired {Math.abs(days)}d ago
      </span>
    );
  }
  if (days <= 30) {
    return (
      <span className="expiry soon" data-testid="expiry-soon">
        <i className="bi bi-exclamation-triangle-fill me-1" />
        {days}d left
      </span>
    );
  }
  return <span className="expiry ok">{days}d left</span>;
}

/**
 * The expiry column sorts on days-remaining rather than on the `validTo` date
 * string, so certificates with no known expiry sink instead of sorting as if
 * they expired in 1970.
 *
 * Sorting is client-side and therefore only orders the current page; the
 * server's own "soonest expiry first" ordering is what makes page 1 the urgent
 * one, so a horizon filter matters more here than paging does.
 */
export default function Certificates() {
  const navigate = useNavigate();
  const [horizon, setHorizon] = useState('');
  const [page, setPage] = useState(1);

  const query = buildQuery({ expiringWithinDays: horizon, page, pageSize: PAGE_SIZE });
  const certs = useAsync<Paged<SslCertificate>>(
    () => api.get<Paged<SslCertificate>>(`/api/certificates${query}`),
    [query],
  );

  const columns = useMemo<Column<SslCertificate>[]>(
    () => [
      {
        key: 'expiry',
        header: 'Expiry',
        sortable: true,
        sortValue: (c) => daysLeft(c),
        render: (c) => <ExpiryCell cert={c} />,
      },
      { key: 'validTo', header: 'Valid to', sortable: true, render: (c) => formatDate(c.validTo) },
      {
        key: 'device',
        header: 'Device',
        render: (c) => (
          <span className="cell-primary cell-mono">
            {c.deviceIp ?? `#${c.deviceId}`}
            <span className="text-muted-token"> :{c.portNumber}</span>
          </span>
        ),
      },
      {
        key: 'subject',
        header: 'Subject',
        sortable: true,
        render: (c) => <span className="cert-name" title={c.subject ?? undefined}>{c.subject ?? '-'}</span>,
      },
      {
        key: 'issuer',
        header: 'Issuer',
        sortable: true,
        render: (c) => (
          <span className="cert-name" title={c.issuer ?? undefined}>
            {c.issuer ?? '-'}
            {c.isSelfSigned && (
              <span className="severity-badge sev-warning ms-2">
                <i className="bi bi-exclamation-triangle-fill" />
                self-signed
              </span>
            )}
          </span>
        ),
      },
      {
        key: 'key',
        header: 'Key',
        render: (c) => (c.keyType ? `${c.keyType.toUpperCase()} ${c.keyBits ?? ''}`.trim() : '-'),
      },
      { key: 'detectedAt', header: 'Seen', render: (c) => formatDate(c.detectedAt) },
    ],
    [],
  );

  return (
    <div data-testid="certificates-page">
      {certs.error && <ErrorBanner message={certs.error} onRetry={certs.reload} />}

      <div className="filter-row">
        <select className="form-select" value={horizon}
          onChange={(e) => { setHorizon(e.target.value); setPage(1); }} aria-label="Expiry horizon" data-testid="cert-horizon">
          <option value="">All certificates</option>
          <option value="90">Expiring within 90 days</option>
          <option value="30">Expiring within 30 days</option>
          <option value="7">Expiring within 7 days</option>
        </select>
      </div>

      <div className="nm-card">
        <DataTable
          columns={columns}
          rows={certs.data?.items ?? []}
          rowKey={(c) => c.id}
          loading={certs.loading}
          onRowClick={(c) => navigate(`/devices/${c.deviceId}`)}
          defaultSort={{ key: 'expiry', dir: 'asc' }}
          emptyTitle="No certificates found"
          emptyMessage="Certificates appear after the security scan profile inspects TLS ports."
          emptyIcon="bi-patch-check"
          testId="certs-table"
        />
        {certs.data && (
          <Pagination
            page={certs.data.page}
            totalPages={certs.data.totalPages}
            total={certs.data.total}
            onPageChange={setPage}
            noun="certificate"
          />
        )}
      </div>
    </div>
  );
}
