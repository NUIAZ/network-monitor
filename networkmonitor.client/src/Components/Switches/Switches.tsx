/**
 * SNMP switches: master-detail. The left rail lists polled targets with an
 * up/total interface rollup and their busiest interface; selecting one loads
 * its per-interface table (status, speed, utilization bar, error counters)
 * and a 24-hour utilization chart.
 *
 * The chart caps itself at the six busiest interfaces — a 48-port switch as
 * 48 lines is noise, and six is where the categorical palette stays honest.
 * The utilization endpoint's exact grouping is normalized in one place
 * (normalizeSamples) so either a flat sample list or a per-interface series
 * shape charts identically.
 */
import { useEffect, useMemo, useState } from 'react';
import {
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
import type { InterfaceSnapshot, SnmpTargetSummary, UtilizationSample } from '../../types';
import { formatBps, formatNumber, formatPercent, relativeTime } from '../../utils/format';
import StatusPill from '../Shared/StatusPill';
import LoadingSpinner from '../Shared/LoadingSpinner';
import ErrorBanner from '../Shared/ErrorBanner';
import EmptyState from '../Shared/EmptyState';
import ChartTooltip from '../Shared/ChartTooltip';
import './Switches.css';

/** Chart series slots, in validated categorical order. */
const SERIES_VARS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)'];
const MAX_SERIES = 6;

/**
 * Accepts either shape the utilization endpoint may return — flat samples or
 * `[{ ifName, points: [...] }]` — and yields flat samples.
 */
function normalizeSamples(raw: unknown): UtilizationSample[] {
  if (!Array.isArray(raw)) return [];
  const out: UtilizationSample[] = [];
  for (const item of raw as Array<Record<string, unknown>>) {
    if (Array.isArray(item.points)) {
      for (const p of item.points as Array<Record<string, unknown>>) {
        out.push({
          ifIndex: Number(item.ifIndex ?? 0),
          ifName: String(item.ifName ?? `if${item.ifIndex ?? '?'}`),
          recordedAt: String(p.recordedAt ?? ''),
          utilizationPercent: Number(p.utilizationPercent ?? 0),
        });
      }
    } else if (item.recordedAt !== undefined) {
      out.push({
        ifIndex: Number(item.ifIndex ?? 0),
        ifName: String(item.ifName ?? `if${item.ifIndex ?? '?'}`),
        recordedAt: String(item.recordedAt),
        utilizationPercent: Number(item.utilizationPercent ?? 0),
      });
    }
  }
  return out;
}

function utilClass(pct: number): string {
  if (pct >= 85) return 'util-bar util-hot';
  if (pct >= 60) return 'util-bar util-warn';
  return 'util-bar';
}

function shortClock(value: string | number): string {
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/**
 * Auto-selects the first target once the list arrives, so the page never sits
 * on an empty detail pane waiting to be clicked. The guard is on `selectedId`
 * being null rather than on first load, which means an explicit selection is
 * never overridden by a later refresh of the rail.
 *
 * The two detail requests resolve to empty arrays while nothing is selected
 * instead of being skipped, so the panes render their empty states through the
 * same path as a target that genuinely has no interfaces.
 */
export default function Switches() {
  const targets = useAsync<SnmpTargetSummary[]>(() => api.get<SnmpTargetSummary[]>('/api/snmp/targets'), []);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Auto-select the first target once the list arrives.
  useEffect(() => {
    if (selectedId === null && targets.data && targets.data.length > 0) {
      setSelectedId(targets.data[0].id);
    }
  }, [targets.data, selectedId]);

  const interfaces = useAsync<InterfaceSnapshot[]>(
    () => (selectedId === null ? Promise.resolve([]) : api.get<InterfaceSnapshot[]>(`/api/snmp/targets/${selectedId}/interfaces`)),
    [selectedId],
  );

  const utilization = useAsync<UtilizationSample[]>(
    () =>
      selectedId === null
        ? Promise.resolve([])
        : api.get<unknown>(`/api/snmp/targets/${selectedId}/utilization?hours=24`).then(normalizeSamples),
    [selectedId],
  );

  const selected = (targets.data ?? []).find((t) => t.id === selectedId) ?? null;

  // Pivot samples into recharts rows, keeping only the busiest interfaces.
  const { chartRows, chartSeries } = useMemo(() => {
    const samples = utilization.data ?? [];
    const peak = new Map<string, number>();
    for (const s of samples) {
      peak.set(s.ifName, Math.max(peak.get(s.ifName) ?? 0, s.utilizationPercent));
    }
    const series = [...peak.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_SERIES)
      .map(([name]) => name);
    const keep = new Set(series);
    const byTime = new Map<string, Record<string, number | string>>();
    for (const s of samples) {
      if (!keep.has(s.ifName)) continue;
      const row = byTime.get(s.recordedAt) ?? { recordedAt: s.recordedAt };
      row[s.ifName] = s.utilizationPercent;
      byTime.set(s.recordedAt, row);
    }
    const rows = [...byTime.values()].sort((a, b) => String(a.recordedAt).localeCompare(String(b.recordedAt)));
    return { chartRows: rows, chartSeries: series };
  }, [utilization.data]);

  if (targets.loading) return <LoadingSpinner label="Loading SNMP targets…" />;
  if (targets.error) return <ErrorBanner message={targets.error} onRetry={targets.reload} />;
  if ((targets.data ?? []).length === 0) {
    return (
      <EmptyState
        icon="bi-ethernet"
        title="No SNMP targets configured"
        message="Switches and routers polled over SNMP will appear here with per-interface throughput."
      />
    );
  }

  return (
    <div className="switches-layout" data-testid="switches-page">
      {/* ---- target rail ---- */}
      <div className="target-rail" data-tour="snmp-targets">
        {(targets.data ?? []).map((t) => (
          <button
            type="button"
            key={t.id}
            className={`target-card${t.id === selectedId ? ' active' : ''}`}
            onClick={() => setSelectedId(t.id)}
            data-testid={`snmp-target-${t.id}`}
          >
            <div className="d-flex align-items-center justify-content-between gap-2">
              <span className="target-name">{t.name}</span>
              <StatusPill status={t.upCount > 0 ? 'up' : 'down'} />
            </div>
            <div className="target-meta mono">{t.ipAddress}</div>
            <div className="target-meta">
              {t.model ?? 'unknown model'}
              {t.siteName && ` · ${t.siteName}`}
            </div>
            <div className="d-flex align-items-center gap-2 mt-1">
              <span className="target-meta">{t.upCount}/{t.interfaceCount} up</span>
              <div className={`${utilClass(t.maxUtilization)} flex-grow-1`}>
                <span style={{ width: `${Math.min(100, Math.max(2, t.maxUtilization))}%` }} />
              </div>
              <span className="target-meta">{formatPercent(t.maxUtilization)}</span>
            </div>
            <div className="target-meta mt-1">
              polled {t.lastPolledAt ? relativeTime(t.lastPolledAt) : 'never'}
            </div>
          </button>
        ))}
      </div>

      {/* ---- detail ---- */}
      <div className="target-detail">
        {selected && (
          <>
            <div className="nm-card mb-3">
              <div className="nm-card-header">
                Utilization · last 24h · {selected.name}
                <i className="bi bi-graph-up-arrow" />
              </div>
              <div className="nm-card-body">
                {utilization.loading ? (
                  <LoadingSpinner label="Loading utilization…" />
                ) : utilization.error ? (
                  <ErrorBanner message={utilization.error} onRetry={utilization.reload} />
                ) : chartRows.length === 0 ? (
                  <EmptyState icon="bi-graph-up" title="No samples yet" message="Utilization appears after a couple of poll cycles." />
                ) : (
                  <>
                    <ResponsiveContainer width="100%" height={260}>
                      <LineChart data={chartRows} margin={{ top: 6, right: 8, left: -14, bottom: 0 }}>
                        <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                        <XAxis dataKey="recordedAt" tickFormatter={shortClock} tickLine={false} axisLine={false} minTickGap={50} />
                        <YAxis unit="%" domain={[0, 100]} tickLine={false} axisLine={false} />
                        <Tooltip content={<ChartTooltip formatLabel={(l) => shortClock(l)} formatValue={(v) => `${Number(v).toFixed(1)}%`} />} />
                        {chartSeries.map((name, i) => (
                          <Line
                            key={name}
                            type="monotone"
                            dataKey={name}
                            name={name}
                            stroke={SERIES_VARS[i]}
                            strokeWidth={2}
                            dot={false}
                            connectNulls
                          />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                    <div className="legend-row mt-2">
                      {chartSeries.map((name, i) => (
                        <span key={name}><span className="dot" style={{ background: SERIES_VARS[i] }} /> {name}</span>
                      ))}
                      {chartSeries.length === MAX_SERIES && (
                        <span className="text-muted-token">(busiest {MAX_SERIES} interfaces)</span>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="nm-card">
              <div className="nm-card-header">
                Interfaces
                <i className="bi bi-ethernet" />
              </div>
              {interfaces.loading ? (
                <LoadingSpinner label="Loading interfaces…" />
              ) : interfaces.error ? (
                <div className="nm-card-body">
                  <ErrorBanner message={interfaces.error} onRetry={interfaces.reload} />
                </div>
              ) : (interfaces.data ?? []).length === 0 ? (
                <EmptyState icon="bi-ethernet" title="No interface data" />
              ) : (
                <div className="nm-table-wrap">
                  <table className="nm-table" data-testid="interface-table">
                    <thead>
                      <tr>
                        <th>Interface</th>
                        <th>Status</th>
                        <th>Speed</th>
                        <th className="util-col">Utilization</th>
                        <th>Errors in/out</th>
                        <th>Sampled</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(interfaces.data ?? []).map((iface) => (
                        <tr key={`${iface.ifIndex}-${iface.ifName}`}>
                          <td>
                            <span className="cell-primary">{iface.ifName}</span>
                            {iface.ifAlias && <div className="text-muted-token small">{iface.ifAlias}</div>}
                          </td>
                          <td><StatusPill status={iface.operStatus} /></td>
                          <td>{formatBps(iface.speedBps)}</td>
                          <td>
                            <div className="d-flex align-items-center gap-2">
                              <div className={`${utilClass(iface.utilizationPercent)} flex-grow-1`}>
                                <span style={{ width: `${Math.min(100, Math.max(iface.utilizationPercent > 0 ? 2 : 0, iface.utilizationPercent))}%` }} />
                              </div>
                              <span className="util-value">{formatPercent(iface.utilizationPercent)}</span>
                            </div>
                          </td>
                          <td className={iface.inErrors + iface.outErrors > 0 ? 'error-count' : undefined}>
                            {formatNumber(iface.inErrors)} / {formatNumber(iface.outErrors)}
                          </td>
                          <td>{relativeTime(iface.recordedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
