/**
 * Device inventory: server-paged, server-sorted table with the full filter
 * set (site, network, status, type, free-text search).
 *
 * All filter state lives in the URL (useSearchParams), which buys three
 * things at once: the global search box and dashboard tiles can deep-link
 * here (?search=, ?status=online), refresh keeps your place, and filtered
 * views are shareable. The search input is debounced so typing doesn't fire
 * a request per keystroke.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, buildQuery } from '../../services/api';
import { useAsync } from '../../hooks/useAsync';
import type { Device, NetworkInfo, Paged, Site } from '../../types';
import { DEVICE_TYPES } from '../../types';
import { relativeTime } from '../../utils/format';
import { deviceTypeIcon } from '../../utils/deviceIcons';
import DataTable from '../Shared/DataTable';
import type { Column, SortState } from '../Shared/DataTable';
import Pagination from '../Shared/Pagination';
import StatusPill from '../Shared/StatusPill';
import ErrorBanner from '../Shared/ErrorBanner';
import './DeviceList.css';

const PAGE_SIZE = 25;

/** Parses the URL sort param ("hostname" asc, "-hostname" desc). */
function parseSort(raw: string | null): SortState | undefined {
  if (!raw) return undefined;
  return raw.startsWith('-') ? { key: raw.slice(1), dir: 'desc' } : { key: raw, dir: 'asc' };
}

/**
 * Holds almost no state of its own: the URL is the state, and the only local
 * value is the debounced echo of the search box (kept so the input stays
 * responsive between the keystroke and the URL catching up 300ms later).
 *
 * Filter changes reset to page 1, staying on page 7 of a result set that just
 * shrank to two pages would show an empty table and look like a failure.
 * Params are written with `replace`, so a filter tweak is not a Back-button
 * step; Back leaves the page rather than undoing one keystroke at a time.
 */
export default function DeviceList() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const search = searchParams.get('search') ?? '';
  const siteId = searchParams.get('siteId') ?? '';
  const networkId = searchParams.get('networkId') ?? '';
  const status = searchParams.get('status') ?? '';
  const deviceType = searchParams.get('deviceType') ?? '';
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);
  const sort = parseSort(searchParams.get('sort'));

  /** Updates one or more params, resetting to page 1 unless paging itself. */
  const updateParams = (updates: Record<string, string>, keepPage = false) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(updates)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (!keepPage) next.delete('page');
    setSearchParams(next, { replace: true });
  };

  // Local echo of the search box, debounced into the URL.
  const [searchText, setSearchText] = useState(search);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => setSearchText(search), [search]);

  const onSearchChange = (value: string) => {
    setSearchText(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => updateParams({ search: value }), 300);
  };

  // Filter option sources.
  const sites = useAsync<Site[]>(() => api.get<Site[]>('/api/sites'), []);
  const networks = useAsync<NetworkInfo[]>(
    () => api.get<NetworkInfo[]>(`/api/networks${buildQuery({ siteId })}`),
    [siteId],
  );

  const query = buildQuery({
    search,
    siteId,
    networkId,
    status,
    deviceType,
    page,
    pageSize: PAGE_SIZE,
    sort: sort ? (sort.dir === 'desc' ? `-${sort.key}` : sort.key) : undefined,
  });

  const devices = useAsync<Paged<Device>>(() => api.get<Paged<Device>>(`/api/devices${query}`), [query]);

  const columns = useMemo<Column<Device>[]>(
    () => [
      {
        key: 'status',
        header: 'Status',
        sortable: true,
        render: (d) => <StatusPill status={d.status} />,
      },
      {
        key: 'ipAddress',
        header: 'IP address',
        sortable: true,
        render: (d) => (
          <span className="cell-primary cell-mono d-inline-flex align-items-center gap-2">
            <i className={`bi ${deviceTypeIcon(d.deviceType)} device-type-icon`} title={d.deviceType} />
            {d.ipAddress}
          </span>
        ),
      },
      {
        key: 'hostname',
        header: 'Hostname',
        sortable: true,
        render: (d) => (
          <span className="cell-primary">
            {d.hostname ?? <span className="text-muted-token">-</span>}
            {d.isFlagged && <i className="bi bi-flag-fill text-flag ms-2" title="Flagged" />}
            {d.isExcluded && <i className="bi bi-eye-slash ms-2 text-muted-token" title="Excluded from scans" />}
          </span>
        ),
      },
      {
        key: 'deviceType',
        header: 'Type',
        sortable: true,
        render: (d) => <span className="text-capitalize">{d.deviceType}</span>,
      },
      { key: 'vendor', header: 'Vendor', sortable: true, render: (d) => d.vendor ?? '-' },
      {
        key: 'osGuess',
        header: 'OS',
        render: (d) => (
          <span className="os-cell" title={d.osGuess ?? undefined}>{d.osGuess ?? '-'}</span>
        ),
      },
      {
        key: 'lastSeen',
        header: 'Last seen',
        sortable: true,
        render: (d) => relativeTime(d.lastSeen),
      },
    ],
    [],
  );

  return (
    <div data-testid="device-list-page">
      {devices.error && <ErrorBanner message={devices.error} onRetry={devices.reload} />}

      <div className="filter-row" data-testid="device-filters">
        <input
          type="search"
          className="form-control device-search"
          placeholder="Search IP, hostname, MAC, vendor…"
          value={searchText}
          onChange={(e) => onSearchChange(e.target.value)}
          data-testid="device-search"
        />
        <select
          className="form-select"
          value={siteId}
          onChange={(e) => updateParams({ siteId: e.target.value, networkId: '' })}
          aria-label="Filter by site"
          data-testid="filter-site"
        >
          <option value="">All sites</option>
          {(sites.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <select
          className="form-select"
          value={networkId}
          onChange={(e) => updateParams({ networkId: e.target.value })}
          aria-label="Filter by network"
          data-testid="filter-network"
        >
          <option value="">All networks</option>
          {(networks.data ?? []).map((n) => (
            <option key={n.id} value={n.id}>{n.name} · {n.cidr}</option>
          ))}
        </select>
        <select
          className="form-select"
          value={status}
          onChange={(e) => updateParams({ status: e.target.value })}
          aria-label="Filter by status"
          data-testid="filter-status"
        >
          <option value="">Any status</option>
          <option value="online">Online</option>
          <option value="offline">Offline</option>
          <option value="new">New</option>
        </select>
        <select
          className="form-select"
          value={deviceType}
          onChange={(e) => updateParams({ deviceType: e.target.value })}
          aria-label="Filter by type"
          data-testid="filter-type"
        >
          <option value="">Any type</option>
          {DEVICE_TYPES.map((t) => (
            <option key={t} value={t} className="text-capitalize">{t}</option>
          ))}
        </select>
      </div>

      <div className="nm-card" data-tour="device-table">
        <DataTable<Device>
          columns={columns}
          rows={devices.data?.items ?? []}
          rowKey={(d) => d.id}
          loading={devices.loading}
          onRowClick={(d) => navigate(`/devices/${d.id}`)}
          sort={sort}
          onSortChange={(next) => updateParams({ sort: next.dir === 'desc' ? `-${next.key}` : next.key }, true)}
          emptyTitle="No devices match"
          emptyMessage="Try widening the filters, or run a scan to discover devices."
          emptyIcon="bi-hdd-network"
          testId="device-table"
        />
        {devices.data && (
          <Pagination
            page={devices.data.page}
            totalPages={devices.data.totalPages}
            total={devices.data.total}
            onPageChange={(p) => updateParams({ page: String(p) }, true)}
            noun="device"
          />
        )}
      </div>
    </div>
  );
}
