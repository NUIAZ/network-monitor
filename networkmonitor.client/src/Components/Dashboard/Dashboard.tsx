/**
 * Dashboard: the "is anything on fire" screen.
 *
 * Six stat tiles (each clicking through to the filtered list behind its
 * number), a device-type donut, 14 days of scan activity, the alert trend
 * stacked by severity, and the newest unacknowledged alerts. When the server
 * reports nmap missing, a banner says so up front — a scanner that can't
 * scan should announce it on the front page, not bury it in Settings.
 */
import { useNavigate } from 'react-router-dom';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../../services/api';
import { useAsync } from '../../hooks/useAsync';
import type {
  Alert,
  AlertTrendPoint,
  DashboardSummary,
  DeviceTypeCount,
  Paged,
  ScanActivityPoint,
} from '../../types';
import { formatDateTime, formatNumber, relativeTime } from '../../utils/format';
import { deviceTypeColor, deviceTypeIcon } from '../../utils/deviceIcons';
import StatCard from '../Shared/StatCard';
import SeverityBadge from '../Shared/SeverityBadge';
import LoadingSpinner from '../Shared/LoadingSpinner';
import ErrorBanner from '../Shared/ErrorBanner';
import EmptyState from '../Shared/EmptyState';
import ChartTooltip from '../Shared/ChartTooltip';
import './Dashboard.css';

interface DashboardData {
  summary: DashboardSummary;
  deviceTypes: DeviceTypeCount[];
  scanActivity: ScanActivityPoint[];
  alertTrend: AlertTrendPoint[];
  recentAlerts: Alert[];
}

/** "2026-08-05" → "Aug 5" for compact chart ticks. */
function shortDate(value: string | number): string {
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function Dashboard() {
  const navigate = useNavigate();

  const { data, loading, error, reload } = useAsync<DashboardData>(async () => {
    // Fire the five requests together — the dashboard is read-only and the
    // pieces are independent, so serializing them would just add latency.
    const [summary, deviceTypes, scanActivity, alertTrend, recent] = await Promise.all([
      api.get<DashboardSummary>('/api/dashboard/summary'),
      api.get<DeviceTypeCount[]>('/api/dashboard/device-types'),
      api.get<ScanActivityPoint[]>('/api/dashboard/scan-activity?days=14'),
      api.get<AlertTrendPoint[]>('/api/dashboard/alert-trend?days=14'),
      api.get<Paged<Alert>>('/api/alerts?acknowledged=false&pageSize=6'),
    ]);
    return { summary, deviceTypes, scanActivity, alertTrend, recentAlerts: recent.items };
  }, []);

  if (loading) return <LoadingSpinner label="Loading dashboard…" />;
  if (error || !data) {
    return <ErrorBanner message={error ?? 'No dashboard data'} onRetry={reload} />;
  }

  const { summary, deviceTypes, scanActivity, alertTrend, recentAlerts } = data;
  const typeTotal = deviceTypes.reduce((sum, t) => sum + t.count, 0);

  return (
    <div data-testid="dashboard">
      {!summary.nmapAvailable && (
        <div className="warn-banner" data-testid="nmap-banner">
          <i className="bi bi-exclamation-triangle-fill" />
          <div>
            <strong>nmap not detected on the server.</strong> Discovery and scanning are disabled —
            existing data is shown, but no new scans will run until nmap is installed and on the PATH.
          </div>
        </div>
      )}

      {/* ---- stat tiles ---- */}
      <div className="stat-grid" data-tour="stat-tiles">
        <StatCard
          icon="bi-hdd-network"
          label="Total devices"
          value={formatNumber(summary.totalDevices)}
          sub={summary.newDevices24h > 0 ? `+${summary.newDevices24h} in last 24h` : 'no new in 24h'}
          tone="accent"
          onClick={() => navigate('/devices')}
          testId="stat-total-devices"
        />
        <StatCard
          icon="bi-wifi"
          label="Online"
          value={formatNumber(summary.onlineDevices)}
          tone="success"
          onClick={() => navigate('/devices?status=online')}
          testId="stat-online"
        />
        <StatCard
          icon="bi-wifi-off"
          label="Offline"
          value={formatNumber(summary.offlineDevices)}
          tone="error"
          onClick={() => navigate('/devices?status=offline')}
          testId="stat-offline"
        />
        <StatCard
          icon="bi-bell"
          label="Open alerts"
          value={formatNumber(summary.openAlerts)}
          sub={summary.criticalAlerts > 0 ? `${summary.criticalAlerts} critical` : 'none critical'}
          tone="warning"
          onClick={() => navigate('/alerts')}
          testId="stat-alerts"
        />
        <StatCard
          icon="bi-bug"
          label="Open vulns"
          value={formatNumber(summary.openVulnerabilities)}
          sub={summary.criticalVulnerabilities > 0 ? `${summary.criticalVulnerabilities} critical` : 'none critical'}
          tone="error"
          onClick={() => navigate('/security/vulnerabilities')}
          testId="stat-vulns"
        />
        <StatCard
          icon="bi-patch-check"
          label="Expiring certs"
          value={formatNumber(summary.expiringCerts)}
          sub="within 30 days"
          tone="warning"
          onClick={() => navigate('/security/certificates')}
          testId="stat-certs"
        />
      </div>

      {/* ---- charts row 1: device types + scan activity ---- */}
      <div className="dash-row" data-tour="dash-charts">
        <div className="nm-card dash-donut-card">
          <div className="nm-card-header">
            Device types
            <i className="bi bi-pie-chart" />
          </div>
          <div className="nm-card-body">
            {deviceTypes.length === 0 ? (
              <EmptyState icon="bi-pie-chart" title="No devices yet" message="Run a scan to discover devices." />
            ) : (
              <div className="donut-layout">
                <div className="donut-chart">
                  <ResponsiveContainer width="100%" height={210}>
                    <PieChart>
                      <Pie
                        data={deviceTypes}
                        dataKey="count"
                        nameKey="deviceType"
                        innerRadius={58}
                        outerRadius={86}
                        paddingAngle={2}
                        stroke="var(--card-bg)"
                        strokeWidth={2}
                      >
                        {deviceTypes.map((t) => (
                          <Cell key={t.deviceType} fill={deviceTypeColor(t.deviceType)} />
                        ))}
                      </Pie>
                      <Tooltip content={<ChartTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="donut-center">
                    <div className="donut-total">{formatNumber(typeTotal)}</div>
                    <div className="donut-caption">devices</div>
                  </div>
                </div>
                <ul className="donut-legend">
                  {deviceTypes.map((t) => (
                    <li key={t.deviceType}>
                      <span className="dot" style={{ background: deviceTypeColor(t.deviceType) }} />
                      <i className={`bi ${deviceTypeIcon(t.deviceType)}`} />
                      <span className="flex-grow-1 text-capitalize">{t.deviceType}</span>
                      <strong>{t.count}</strong>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        <div className="nm-card dash-activity-card">
          <div className="nm-card-header">
            Scan activity · last 14 days
            <i className="bi bi-activity" />
          </div>
          <div className="nm-card-body">
            {scanActivity.length === 0 ? (
              <EmptyState icon="bi-activity" title="No scans recorded" />
            ) : (
              <>
                <ResponsiveContainer width="100%" height={230}>
                  <AreaChart data={scanActivity} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                    <XAxis dataKey="date" tickFormatter={shortDate} tickLine={false} axisLine={false} />
                    <YAxis tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip content={<ChartTooltip formatLabel={shortDate} />} />
                    <Area
                      type="monotone"
                      dataKey="scans"
                      name="Scans run"
                      stroke="var(--chart-1)"
                      strokeWidth={2}
                      fill="var(--chart-1)"
                      fillOpacity={0.18}
                    />
                    <Area
                      type="monotone"
                      dataKey="newDevices"
                      name="New devices"
                      stroke="var(--chart-2)"
                      strokeWidth={2}
                      fill="var(--chart-2)"
                      fillOpacity={0.18}
                    />
                  </AreaChart>
                </ResponsiveContainer>
                <div className="legend-row mt-2">
                  <span><span className="dot" style={{ background: 'var(--chart-1)' }} /> Scans run</span>
                  <span><span className="dot" style={{ background: 'var(--chart-2)' }} /> New devices</span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ---- charts row 2: alert trend + recent alerts ---- */}
      <div className="dash-row">
        <div className="nm-card dash-trend-card">
          <div className="nm-card-header">
            Alert trend · last 14 days
            <i className="bi bi-bar-chart" />
          </div>
          <div className="nm-card-body">
            {alertTrend.length === 0 ? (
              <EmptyState icon="bi-bar-chart" title="No alerts recorded" />
            ) : (
              <>
                <ResponsiveContainer width="100%" height={230}>
                  <BarChart data={alertTrend} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                    <XAxis dataKey="date" tickFormatter={shortDate} tickLine={false} axisLine={false} />
                    <YAxis tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip content={<ChartTooltip formatLabel={shortDate} />} cursor={{ fill: 'var(--hover-bg)' }} />
                    <Bar dataKey="info" name="Info" stackId="sev" fill="var(--info)" />
                    <Bar dataKey="warning" name="Warning" stackId="sev" fill="var(--warning)" />
                    <Bar dataKey="critical" name="Critical" stackId="sev" fill="var(--error)" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
                <div className="legend-row mt-2">
                  <span><span className="dot" style={{ background: 'var(--info)' }} /> Info</span>
                  <span><span className="dot" style={{ background: 'var(--warning)' }} /> Warning</span>
                  <span><span className="dot" style={{ background: 'var(--error)' }} /> Critical</span>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="nm-card dash-alerts-card">
          <div className="nm-card-header">
            Recent alerts
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => navigate('/alerts')}>
              View all
            </button>
          </div>
          <div className="nm-card-body p-0">
            {recentAlerts.length === 0 ? (
              <EmptyState icon="bi-bell-slash" title="All clear" message="No unacknowledged alerts." />
            ) : (
              <ul className="recent-alert-list" data-testid="recent-alerts">
                {recentAlerts.map((alert) => (
                  <li
                    key={alert.id}
                    onClick={() => (alert.deviceId ? navigate(`/devices/${alert.deviceId}`) : navigate('/alerts'))}
                  >
                    <SeverityBadge severity={alert.severity} />
                    <span className="alert-message" title={alert.message}>{alert.message}</span>
                    <span className="alert-time">{relativeTime(alert.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* ---- footer meta ---- */}
      <div className="dash-meta text-muted-token">
        <span><i className="bi bi-buildings me-1" /> {summary.sites} sites</span>
        <span><i className="bi bi-diagram-2 me-1" /> {summary.networks} networks</span>
        <span>
          <i className="bi bi-clock-history me-1" /> Last scan: {summary.lastScanAt ? formatDateTime(summary.lastScanAt) : 'never'}
        </span>
        {summary.nmapAvailable && summary.nmapVersion && (
          <span><i className="bi bi-terminal me-1" /> nmap {summary.nmapVersion}</span>
        )}
      </div>
    </div>
  );
}
