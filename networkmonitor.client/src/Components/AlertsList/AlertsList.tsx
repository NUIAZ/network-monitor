/**
 * Alerts: the triage queue. Filterable by severity, type, and acknowledgment
 * state; acknowledge one, or everything matching the current severity filter
 * at once (behind a confirm — "acknowledge all" is the kind of button people
 * hit by accident).
 *
 * Acknowledging refreshes the shared alert-count context so the sidebar
 * badge drops immediately rather than on its next poll.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, buildQuery } from '../../services/api';
import { useAsync } from '../../hooks/useAsync';
import { useAlertCount } from '../../context/AlertCountContext';
import type { Alert, Paged } from '../../types';
import { ALERT_TYPES } from '../../types';
import { humanize, relativeTime } from '../../utils/format';
import DataTable from '../Shared/DataTable';
import type { Column } from '../Shared/DataTable';
import Pagination from '../Shared/Pagination';
import SeverityBadge from '../Shared/SeverityBadge';
import ErrorBanner from '../Shared/ErrorBanner';
import ConfirmDialog from '../Shared/ConfirmDialog';
import './AlertsList.css';

const PAGE_SIZE = 25;

/** Identity recorded on acknowledgments in this unauthenticated build. */
const ACK_BY = 'operator';

export default function AlertsList() {
  const navigate = useNavigate();
  const { refresh: refreshBadge } = useAlertCount();

  const [severity, setSeverity] = useState('');
  const [alertType, setAlertType] = useState('');
  const [ackState, setAckState] = useState('open'); // open | acked | all
  const [page, setPage] = useState(1);
  const [ackError, setAckError] = useState<string | null>(null);
  const [ackingId, setAckingId] = useState<number | null>(null);
  const [confirmAckAll, setConfirmAckAll] = useState(false);
  const [ackAllBusy, setAckAllBusy] = useState(false);

  const query = buildQuery({
    severity,
    alertType,
    acknowledged: ackState === 'all' ? undefined : ackState === 'acked' ? 'true' : 'false',
    page,
    pageSize: PAGE_SIZE,
  });

  const alerts = useAsync<Paged<Alert>>(() => api.get<Paged<Alert>>(`/api/alerts${query}`), [query]);

  const acknowledge = async (alert: Alert) => {
    setAckingId(alert.id);
    setAckError(null);
    try {
      await api.post(`/api/alerts/${alert.id}/acknowledge`, { acknowledgedBy: ACK_BY });
      alerts.reload();
      refreshBadge();
    } catch (err) {
      setAckError(err instanceof Error ? err.message : 'Acknowledge failed');
    } finally {
      setAckingId(null);
    }
  };

  const acknowledgeAll = async () => {
    setAckAllBusy(true);
    setAckError(null);
    try {
      // Scoped to the active severity filter when one is set — "ack all
      // criticals" is a deliberate workflow; "ack the entire queue" is opt-in.
      await api.post('/api/alerts/acknowledge-all', {
        severity: severity || undefined,
        acknowledgedBy: ACK_BY,
      });
      setConfirmAckAll(false);
      alerts.reload();
      refreshBadge();
    } catch (err) {
      setAckError(err instanceof Error ? err.message : 'Acknowledge-all failed');
    } finally {
      setAckAllBusy(false);
    }
  };

  const columns = useMemo<Column<Alert>[]>(
    () => [
      { key: 'severity', header: 'Severity', render: (a) => <SeverityBadge severity={a.severity} /> },
      {
        key: 'message',
        header: 'Alert',
        render: (a) => (
          <div className="alert-cell">
            <span className="cell-primary">{a.message}</span>
            {a.details && <span className="alert-details" title={a.details}>{a.details}</span>}
          </div>
        ),
      },
      { key: 'alertType', header: 'Type', render: (a) => <span className="type-chip">{humanize(a.alertType)}</span> },
      {
        key: 'createdAt',
        header: 'When',
        render: (a) => <span title={a.createdAt}>{relativeTime(a.createdAt)}</span>,
      },
      {
        key: 'ack',
        header: 'Ack',
        render: (a) =>
          a.isAcknowledged ? (
            <span className="acked" title={a.acknowledgedAt ? `by ${a.acknowledgedBy ?? '?'} · ${relativeTime(a.acknowledgedAt)}` : undefined}>
              <i className="bi bi-check2-circle me-1" />
              {a.acknowledgedBy ?? 'acknowledged'}
            </span>
          ) : (
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              disabled={ackingId === a.id}
              onClick={(e) => {
                e.stopPropagation(); // row click navigates; the button must not
                acknowledge(a);
              }}
              data-testid={`ack-${a.id}`}
            >
              {ackingId === a.id ? '…' : 'Acknowledge'}
            </button>
          ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ackingId],
  );

  return (
    <div data-testid="alerts-page">
      {(alerts.error || ackError) && (
        <ErrorBanner
          message={alerts.error ?? ackError ?? ''}
          onRetry={alerts.error ? alerts.reload : undefined}
          onDismiss={ackError ? () => setAckError(null) : undefined}
        />
      )}

      <div className="filter-row">
        <select className="form-select" value={ackState}
          onChange={(e) => { setAckState(e.target.value); setPage(1); }} aria-label="Acknowledgment state" data-testid="filter-ack">
          <option value="open">Unacknowledged</option>
          <option value="acked">Acknowledged</option>
          <option value="all">All alerts</option>
        </select>
        <select className="form-select" value={severity}
          onChange={(e) => { setSeverity(e.target.value); setPage(1); }} aria-label="Filter by severity" data-testid="filter-severity">
          <option value="">Any severity</option>
          <option value="critical">Critical</option>
          <option value="warning">Warning</option>
          <option value="info">Info</option>
        </select>
        <select className="form-select" value={alertType}
          onChange={(e) => { setAlertType(e.target.value); setPage(1); }} aria-label="Filter by type" data-testid="filter-alert-type">
          <option value="">Any type</option>
          {ALERT_TYPES.map((t) => (
            <option key={t} value={t}>{humanize(t)}</option>
          ))}
        </select>
        {ackState === 'open' && (alerts.data?.total ?? 0) > 0 && (
          <button type="button" className="btn btn-ghost ms-auto" onClick={() => setConfirmAckAll(true)} data-testid="ack-all">
            <i className="bi bi-check2-all me-1" />
            Acknowledge all{severity ? ` ${severity}` : ''}
          </button>
        )}
      </div>

      <div className="nm-card">
        <DataTable
          columns={columns}
          rows={alerts.data?.items ?? []}
          rowKey={(a) => a.id}
          loading={alerts.loading}
          onRowClick={(a) => a.deviceId && navigate(`/devices/${a.deviceId}`)}
          emptyTitle={ackState === 'open' ? 'All clear' : 'No alerts match'}
          emptyMessage={ackState === 'open' ? 'Nothing needs your attention right now.' : 'Try widening the filters.'}
          emptyIcon="bi-bell-slash"
          testId="alerts-table"
        />
        {alerts.data && (
          <Pagination
            page={alerts.data.page}
            totalPages={alerts.data.totalPages}
            total={alerts.data.total}
            onPageChange={setPage}
            noun="alert"
          />
        )}
      </div>

      <ConfirmDialog
        open={confirmAckAll}
        title={severity ? `Acknowledge all ${severity} alerts?` : 'Acknowledge all alerts?'}
        message={`${alerts.data?.total ?? 0} open alert(s) will be marked acknowledged by "${ACK_BY}". This cannot be undone.`}
        confirmLabel="Acknowledge all"
        busy={ackAllBusy}
        onConfirm={acknowledgeAll}
        onCancel={() => setConfirmAckAll(false)}
      />
    </div>
  );
}
