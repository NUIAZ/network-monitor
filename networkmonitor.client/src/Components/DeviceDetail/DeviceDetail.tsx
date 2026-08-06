/**
 * Device detail: everything the system knows about one device.
 *
 * Read-only identity (what scans discovered) is deliberately separated from
 * the operator-owned fields (what a human knows: hardware, location, owner,
 * notes, flag/exclude) — the PUT only ever sends the operator fields, so a
 * form save can never fight the scanner over discovered facts.
 *
 * The 7-day history renders as two stacked charts sharing a time axis —
 * availability (a 0/1 step) and latency (ms) are different scales, and a
 * dual-axis chart would invite reading a slope that isn't there.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../../services/api';
import { useAsync } from '../../hooks/useAsync';
import type { Device, DeviceHistoryPoint, DeviceUpdatePayload } from '../../types';
import { DEVICE_TYPES } from '../../types';
import { formatDateTime, formatNumber, relativeTime } from '../../utils/format';
import { deviceTypeIcon } from '../../utils/deviceIcons';
import DataTable from '../Shared/DataTable';
import type { Column } from '../Shared/DataTable';
import StatusPill from '../Shared/StatusPill';
import SeverityBadge from '../Shared/SeverityBadge';
import LoadingSpinner from '../Shared/LoadingSpinner';
import ErrorBanner from '../Shared/ErrorBanner';
import EmptyState from '../Shared/EmptyState';
import ConfirmDialog from '../Shared/ConfirmDialog';
import ChartTooltip from '../Shared/ChartTooltip';
import './DeviceDetail.css';

/** Operator form state — mirrors DeviceUpdatePayload with string inputs. */
interface OperatorForm {
  hostname: string;
  hardware: string;
  physicalLocation: string;
  assignedTo: string;
  notes: string;
  deviceType: string;
  isFlagged: boolean;
  isExcluded: boolean;
}

function toForm(device: Device): OperatorForm {
  return {
    hostname: device.hostname ?? '',
    hardware: device.hardware ?? '',
    physicalLocation: device.physicalLocation ?? '',
    assignedTo: device.assignedTo ?? '',
    notes: device.notes ?? '',
    deviceType: device.deviceType,
    isFlagged: device.isFlagged,
    isExcluded: device.isExcluded,
  };
}

function shortTime(value: string | number): string {
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function DeviceDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const device = useAsync<Device>(() => api.get<Device>(`/api/devices/${id}`), [id]);
  const history = useAsync<DeviceHistoryPoint[]>(
    () => api.get<DeviceHistoryPoint[]>(`/api/devices/${id}/history?days=7`),
    [id],
  );

  const [form, setForm] = useState<OperatorForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // (Re)hydrate the form whenever a fresh device arrives.
  useEffect(() => {
    if (device.data) setForm(toForm(device.data));
  }, [device.data]);

  const chartData = useMemo(
    () =>
      (history.data ?? []).map((point) => ({
        recordedAt: point.recordedAt,
        up: point.status === 'offline' ? 0 : 1,
        latency: point.responseTimeMs,
        ports: point.openPortCount,
      })),
    [history.data],
  );

  const save = async () => {
    if (!form) return;
    setSaving(true);
    setSaveError(null);
    const payload: DeviceUpdatePayload = {
      hostname: form.hostname.trim() || null,
      hardware: form.hardware.trim() || null,
      physicalLocation: form.physicalLocation.trim() || null,
      assignedTo: form.assignedTo.trim() || null,
      notes: form.notes.trim() || null,
      isFlagged: form.isFlagged,
      isExcluded: form.isExcluded,
      deviceType: form.deviceType,
    };
    try {
      await api.put(`/api/devices/${id}`, payload);
      setSavedAt(Date.now());
      device.reload();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      await api.del(`/api/devices/${id}`);
      navigate('/devices');
    } catch (err) {
      setDeleting(false);
      setConfirmDelete(false);
      setSaveError(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const portColumns = useMemo<Column<NonNullable<Device['ports']>[number]>[]>(
    () => [
      { key: 'portNumber', header: 'Port', sortable: true, className: 'cell-mono' },
      { key: 'protocol', header: 'Protocol', sortable: true },
      { key: 'state', header: 'State', render: (p) => <StatusPill status={p.state} /> },
      { key: 'serviceName', header: 'Service', sortable: true, render: (p) => p.serviceName ?? '—' },
      { key: 'serviceVersion', header: 'Version', render: (p) => p.serviceVersion ?? '—' },
      { key: 'lastSeen', header: 'Last seen', sortable: true, render: (p) => relativeTime(p.lastSeen) },
    ],
    [],
  );

  if (device.loading) return <LoadingSpinner label="Loading device…" />;
  if (device.error || !device.data) {
    return <ErrorBanner message={device.error ?? 'Device not found'} onRetry={device.reload} />;
  }

  const d = device.data;

  return (
    <div data-testid="device-detail">
      <div className="page-title-row">
        <div className="d-flex align-items-center gap-3 flex-wrap">
          <Link to="/devices" className="btn btn-ghost btn-sm" data-testid="back-to-devices">
            <i className="bi bi-arrow-left" />
          </Link>
          <h2 className="d-flex align-items-center gap-2 mb-0">
            <i className={`bi ${deviceTypeIcon(d.deviceType)} text-muted-token`} />
            {d.hostname ?? d.ipAddress}
          </h2>
          <StatusPill status={d.status} />
          {d.isFlagged && <span className="severity-badge sev-warning"><i className="bi bi-flag-fill" /> Flagged</span>}
          {d.isExcluded && <span className="severity-badge"><i className="bi bi-eye-slash" /> Excluded</span>}
        </div>
        <button type="button" className="btn btn-danger-soft" onClick={() => setConfirmDelete(true)} data-testid="delete-device">
          <i className="bi bi-trash me-1" />
          Delete
        </button>
      </div>

      {saveError && <ErrorBanner message={saveError} onDismiss={() => setSaveError(null)} />}

      <div className="detail-grid">
        {/* ---- identity (discovered facts, read-only) ---- */}
        <div className="nm-card">
          <div className="nm-card-header">
            Identity
            <i className="bi bi-fingerprint" />
          </div>
          <div className="nm-card-body">
            <dl className="identity-list">
              <dt>IP address</dt>
              <dd className="mono">{d.ipAddress}</dd>
              <dt>MAC address</dt>
              <dd className="mono">{d.macAddress ?? '—'}</dd>
              <dt>Vendor</dt>
              <dd>{d.vendor ?? '—'}</dd>
              <dt>OS guess</dt>
              <dd>{d.osGuess ?? '—'}</dd>
              <dt>First seen</dt>
              <dd>{formatDateTime(d.firstSeen)}</dd>
              <dt>Last seen</dt>
              <dd>{formatDateTime(d.lastSeen)} ({relativeTime(d.lastSeen)})</dd>
              <dt>Last scanned</dt>
              <dd>{d.lastScannedAt ? formatDateTime(d.lastScannedAt) : '—'}</dd>
              <dt>Missed scans</dt>
              <dd>{formatNumber(d.missedScans)}</dd>
            </dl>
          </div>
        </div>

        {/* ---- operator fields (editable) ---- */}
        <div className="nm-card">
          <div className="nm-card-header">
            Operator fields
            <span className="d-flex align-items-center gap-2">
              {savedAt && Date.now() - savedAt < 4000 && (
                <span className="saved-note" data-testid="saved-note"><i className="bi bi-check2 me-1" />Saved</span>
              )}
              <button type="button" className="btn btn-accent btn-sm" onClick={save} disabled={saving || !form} data-testid="save-device">
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </span>
          </div>
          <div className="nm-card-body">
            {form && (
              <div className="operator-form">
                <div>
                  <label className="form-label" htmlFor="f-hostname">Hostname</label>
                  <input id="f-hostname" className="form-control" value={form.hostname}
                    onChange={(e) => setForm({ ...form, hostname: e.target.value })} data-testid="input-hostname" />
                </div>
                <div>
                  <label className="form-label" htmlFor="f-type">Device type</label>
                  <select id="f-type" className="form-select" value={form.deviceType}
                    onChange={(e) => setForm({ ...form, deviceType: e.target.value })}>
                    {DEVICE_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="form-label" htmlFor="f-hardware">Hardware</label>
                  <input id="f-hardware" className="form-control" value={form.hardware} placeholder="e.g. Catalyst 2960X"
                    onChange={(e) => setForm({ ...form, hardware: e.target.value })} />
                </div>
                <div>
                  <label className="form-label" htmlFor="f-location">Physical location</label>
                  <input id="f-location" className="form-control" value={form.physicalLocation} placeholder="e.g. MDF rack 2"
                    onChange={(e) => setForm({ ...form, physicalLocation: e.target.value })} />
                </div>
                <div>
                  <label className="form-label" htmlFor="f-assigned">Assigned to</label>
                  <input id="f-assigned" className="form-control" value={form.assignedTo} placeholder="Owning team or purpose"
                    onChange={(e) => setForm({ ...form, assignedTo: e.target.value })} />
                </div>
                <div className="operator-notes">
                  <label className="form-label" htmlFor="f-notes">Notes</label>
                  <textarea id="f-notes" className="form-control" rows={3} value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                </div>
                <div className="operator-checks">
                  <label className="form-check">
                    <input type="checkbox" className="form-check-input" checked={form.isFlagged}
                      onChange={(e) => setForm({ ...form, isFlagged: e.target.checked })} data-testid="check-flagged" />
                    <span className="form-check-label">Flagged for attention</span>
                  </label>
                  <label className="form-check">
                    <input type="checkbox" className="form-check-input" checked={form.isExcluded}
                      onChange={(e) => setForm({ ...form, isExcluded: e.target.checked })} />
                    <span className="form-check-label">Exclude from scans (passed to nmap --exclude)</span>
                  </label>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ---- 7-day history ---- */}
      <div className="nm-card mt-3">
        <div className="nm-card-header">
          Availability &amp; latency · last 7 days
          <i className="bi bi-graph-up" />
        </div>
        <div className="nm-card-body">
          {history.loading ? (
            <LoadingSpinner label="Loading history…" />
          ) : history.error ? (
            <ErrorBanner message={history.error} onRetry={history.reload} />
          ) : chartData.length === 0 ? (
            <EmptyState icon="bi-graph-up" title="No history yet" message="History appears after this device has been covered by a few scans." />
          ) : (
            <>
              <div className="history-chart-label">Availability</div>
              <ResponsiveContainer width="100%" height={90}>
                <AreaChart data={chartData} margin={{ top: 4, right: 8, left: -18, bottom: 0 }} syncId="devhistory">
                  <XAxis dataKey="recordedAt" tickFormatter={shortTime} tickLine={false} axisLine={false} minTickGap={40} />
                  <YAxis domain={[0, 1]} ticks={[0, 1]} tickFormatter={(v: number) => (v === 1 ? 'up' : 'down')} tickLine={false} axisLine={false} />
                  <Tooltip
                    content={
                      <ChartTooltip
                        formatLabel={(l) => formatDateTime(String(l))}
                        formatValue={(v) => (Number(v) === 1 ? 'up' : 'down')}
                      />
                    }
                  />
                  <Area type="stepAfter" dataKey="up" name="Status" stroke="var(--success)" strokeWidth={2} fill="var(--success)" fillOpacity={0.18} />
                </AreaChart>
              </ResponsiveContainer>
              <div className="history-chart-label mt-2">Latency (ms)</div>
              <ResponsiveContainer width="100%" height={140}>
                <LineChart data={chartData} margin={{ top: 4, right: 8, left: -18, bottom: 0 }} syncId="devhistory">
                  <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                  <XAxis dataKey="recordedAt" tickFormatter={shortTime} tickLine={false} axisLine={false} minTickGap={40} />
                  <YAxis tickLine={false} axisLine={false} />
                  <Tooltip
                    content={
                      <ChartTooltip
                        formatLabel={(l) => formatDateTime(String(l))}
                        formatValue={(v) => `${v} ms`}
                      />
                    }
                  />
                  <Line type="monotone" dataKey="latency" name="Latency" stroke="var(--chart-1)" strokeWidth={2} dot={false} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </>
          )}
        </div>
      </div>

      {/* ---- open ports ---- */}
      <div className="nm-card mt-3">
        <div className="nm-card-header">
          Open ports {d.ports && d.ports.length > 0 && <span className="text-muted-token">({d.ports.length})</span>}
          <i className="bi bi-door-open" />
        </div>
        <DataTable
          columns={portColumns}
          rows={d.ports ?? []}
          rowKey={(p) => p.id}
          defaultSort={{ key: 'portNumber', dir: 'asc' }}
          emptyTitle="No open ports recorded"
          emptyMessage="A deep scan populates the port table."
          emptyIcon="bi-door-closed"
          testId="ports-table"
        />
      </div>

      {/* ---- related alerts / vulns / certs ---- */}
      <div className="detail-grid mt-3">
        <div className="nm-card">
          <div className="nm-card-header">
            Recent alerts
            <i className="bi bi-bell" />
          </div>
          <div className="nm-card-body p-0">
            {(d.alerts ?? []).length === 0 ? (
              <EmptyState icon="bi-bell-slash" title="No alerts for this device" />
            ) : (
              <ul className="device-alert-list">
                {(d.alerts ?? []).map((alert) => (
                  <li key={alert.id}>
                    <SeverityBadge severity={alert.severity} />
                    <span className="flex-grow-1">{alert.message}</span>
                    <span className="text-muted-token">{relativeTime(alert.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="nm-card">
          <div className="nm-card-header">
            Vulnerabilities
            <i className="bi bi-bug" />
          </div>
          <div className="nm-card-body p-0">
            {(d.vulnerabilities ?? []).length === 0 ? (
              <EmptyState icon="bi-shield-check" title="No known vulnerabilities" />
            ) : (
              <ul className="device-alert-list">
                {(d.vulnerabilities ?? []).map((vuln) => (
                  <li key={vuln.id}>
                    <SeverityBadge severity={vuln.severity} />
                    <span className="mono">{vuln.cveId}</span>
                    <span className="flex-grow-1 vuln-desc" title={vuln.description ?? undefined}>
                      {vuln.affectedService ?? vuln.description ?? ''}
                    </span>
                    {vuln.cvssScore != null && <strong>{vuln.cvssScore.toFixed(1)}</strong>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <div className="nm-card mt-3 mb-4">
        <div className="nm-card-header">
          TLS certificates
          <i className="bi bi-patch-check" />
        </div>
        <div className="nm-card-body p-0">
          {(d.certificates ?? []).length === 0 ? (
            <EmptyState icon="bi-patch-check" title="No certificates observed" message="Certificates are collected by the security scan profile." />
          ) : (
            <div className="nm-table-wrap">
              <table className="nm-table">
                <thead>
                  <tr>
                    <th>Port</th>
                    <th>Subject</th>
                    <th>Issuer</th>
                    <th>Valid to</th>
                    <th>Key</th>
                    <th>Self-signed</th>
                  </tr>
                </thead>
                <tbody>
                  {(d.certificates ?? []).map((cert) => (
                    <tr key={cert.id}>
                      <td className="cell-mono">{cert.portNumber}</td>
                      <td className="cell-primary">{cert.subject ?? '—'}</td>
                      <td>{cert.issuer ?? '—'}</td>
                      <td>{formatDateTime(cert.validTo)}</td>
                      <td>{cert.keyType ? `${cert.keyType} ${cert.keyBits ?? ''}`.trim() : '—'}</td>
                      <td>{cert.isSelfSigned ? <span className="severity-badge sev-warning"><i className="bi bi-exclamation-triangle-fill" />Yes</span> : 'No'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this device?"
        message={`${d.hostname ?? d.ipAddress} and its ports, history, alerts, vulnerabilities, and certificates will be removed. It will reappear as "new" if a future scan finds it.`}
        confirmLabel="Delete device"
        danger
        busy={deleting}
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
