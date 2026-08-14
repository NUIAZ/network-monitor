/**
 * Settings: system panel, app settings, sites & networks CRUD, and the
 * per-network scan-profile editor.
 *
 * The sites/networks editors are deliberately modal-based rather than inline
 * grids: create/edit is a deliberate act with validation (CIDR especially —
 * a bad CIDR here becomes a bad nmap command line later, so it's checked
 * client-side before the server sees it, and the server's own rejection is
 * surfaced verbatim if it still objects).
 */
import { useEffect, useState } from 'react';
import { api, buildQuery } from '../../services/api';
import { useAsync } from '../../hooks/useAsync';
import type {
  AppSetting,
  NetworkInfo,
  NetworkPayload,
  ScanProfile,
  Site,
  SitePayload,
  SystemInfo,
} from '../../types';
import { formatDuration, humanize, isValidCidr } from '../../utils/format';
import LoadingSpinner from '../Shared/LoadingSpinner';
import ErrorBanner from '../Shared/ErrorBanner';
import EmptyState from '../Shared/EmptyState';
import ConfirmDialog from '../Shared/ConfirmDialog';
import StatusPill from '../Shared/StatusPill';
import './Settings.css';

// ---------------------------------------------------------------------------
// System info panel
// ---------------------------------------------------------------------------

function SystemPanel() {
  const system = useAsync<SystemInfo>(() => api.get<SystemInfo>('/api/settings/system'), []);

  return (
    <div className="nm-card">
      <div className="nm-card-header">
        System
        <i className="bi bi-cpu" />
      </div>
      <div className="nm-card-body">
        {system.loading ? (
          <LoadingSpinner label="Loading system info…" />
        ) : system.error ? (
          <ErrorBanner message={system.error} onRetry={system.reload} />
        ) : system.data ? (
          <dl className="system-list" data-testid="system-info">
            <dt>Version</dt>
            <dd>v{system.data.version}</dd>
            <dt>nmap</dt>
            <dd>
              {system.data.nmapAvailable ? (
                <span className="text-ok"><i className="bi bi-check-circle-fill me-1" />available{system.data.nmapVersion ? ` · ${system.data.nmapVersion}` : ''}</span>
              ) : (
                <span className="text-bad"><i className="bi bi-x-circle-fill me-1" />not detected</span>
              )}
            </dd>
            <dt>Scheduler</dt>
            <dd>{system.data.schedulerEnabled ? <StatusPill status="enabled" /> : <StatusPill status="down" />}</dd>
            <dt>Data provider</dt>
            <dd>{system.data.provider}</dd>
            <dt>Demo mode</dt>
            <dd>{system.data.demoMode ? <span className="severity-badge sev-info"><i className="bi bi-easel" />seeded demo data</span> : 'off'}</dd>
            <dt>Instance name</dt>
            <dd>{system.data.companyName}</dd>
          </dl>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// App settings (key/value)
// ---------------------------------------------------------------------------

function AppSettingsPanel() {
  const settings = useAsync<AppSetting[]>(() => api.get<AppSetting[]>('/api/settings'), []);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async (setting: AppSetting) => {
    const value = drafts[setting.key];
    if (value === undefined) return;
    setSavingKey(setting.key);
    setError(null);
    try {
      await api.put(`/api/settings/${encodeURIComponent(setting.key)}`, { value });
      setDrafts((d) => {
        const next = { ...d };
        delete next[setting.key];
        return next;
      });
      settings.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <div className="nm-card">
      <div className="nm-card-header">
        Application settings
        <i className="bi bi-sliders" />
      </div>
      <div className="nm-card-body">
        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
        {settings.loading ? (
          <LoadingSpinner label="Loading settings…" />
        ) : settings.error ? (
          <ErrorBanner message={settings.error} onRetry={settings.reload} />
        ) : (settings.data ?? []).length === 0 ? (
          <EmptyState icon="bi-sliders" title="No settings defined" />
        ) : (
          <div className="settings-rows">
            {(settings.data ?? []).map((setting) => {
              const draft = drafts[setting.key];
              const dirty = draft !== undefined && draft !== (setting.value ?? '');
              return (
                <div className="setting-row" key={setting.key}>
                  <div className="setting-info">
                    <div className="setting-key">{humanize(setting.key)}</div>
                    {setting.description && <div className="setting-desc">{setting.description}</div>}
                  </div>
                  <input
                    className="form-control setting-input"
                    value={draft ?? setting.value ?? ''}
                    onChange={(e) => setDrafts((d) => ({ ...d, [setting.key]: e.target.value }))}
                    data-testid={`setting-${setting.key}`}
                  />
                  <button
                    type="button"
                    className="btn btn-accent btn-sm"
                    disabled={!dirty || savingKey === setting.key}
                    onClick={() => save(setting)}
                  >
                    {savingKey === setting.key ? '…' : 'Save'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Site editor modal
// ---------------------------------------------------------------------------

interface SiteFormState {
  siteKey: string;
  name: string;
  city: string;
  state: string;
  latitude: string;
  longitude: string;
}

const emptySiteForm: SiteFormState = { siteKey: '', name: '', city: '', state: '', latitude: '', longitude: '' };

function SiteModal({
  site,
  onClose,
  onSaved,
}: {
  site: Site | null; // null = create
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<SiteFormState>(
    site
      ? {
          siteKey: site.siteKey,
          name: site.name,
          city: site.city ?? '',
          state: site.state ?? '',
          latitude: site.latitude?.toString() ?? '',
          longitude: site.longitude?.toString() ?? '',
        }
      : emptySiteForm,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = form.siteKey.trim().length > 0 && form.name.trim().length > 0;

  const submit = async () => {
    setBusy(true);
    setError(null);
    const payload: SitePayload = {
      siteKey: form.siteKey.trim().toUpperCase(),
      name: form.name.trim(),
      city: form.city.trim(),
      state: form.state.trim().toUpperCase(),
      latitude: form.latitude.trim() === '' ? null : Number(form.latitude),
      longitude: form.longitude.trim() === '' ? null : Number(form.longitude),
    };
    try {
      if (site) await api.put(`/api/sites/${site.id}`, payload);
      else await api.post('/api/sites', payload);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
      setBusy(false);
    }
  };

  return (
    <div className="nm-modal-backdrop" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="nm-modal settings-modal" role="dialog" aria-modal="true" data-testid="site-modal">
        <h5>{site ? `Edit ${site.name}` : 'New site'}</h5>
        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
        <div className="modal-form">
          <div>
            <label className="form-label">Site key</label>
            <input className="form-control" value={form.siteKey} maxLength={20} placeholder="e.g. DAL"
              onChange={(e) => setForm({ ...form, siteKey: e.target.value })} data-testid="site-key" />
          </div>
          <div>
            <label className="form-label">Name</label>
            <input className="form-control" value={form.name} placeholder="e.g. Dallas Distribution Center"
              onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="site-name" />
          </div>
          <div>
            <label className="form-label">City</label>
            <input className="form-control" value={form.city}
              onChange={(e) => setForm({ ...form, city: e.target.value })} />
          </div>
          <div>
            <label className="form-label">State</label>
            <input className="form-control" value={form.state} maxLength={2} placeholder="TX"
              onChange={(e) => setForm({ ...form, state: e.target.value })} />
          </div>
          <div>
            <label className="form-label">Latitude</label>
            <input className="form-control" type="number" step="any" value={form.latitude}
              onChange={(e) => setForm({ ...form, latitude: e.target.value })} />
          </div>
          <div>
            <label className="form-label">Longitude</label>
            <input className="form-control" type="number" step="any" value={form.longitude}
              onChange={(e) => setForm({ ...form, longitude: e.target.value })} />
          </div>
        </div>
        <div className="nm-modal-actions mt-3">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn btn-accent" onClick={submit} disabled={!valid || busy} data-testid="site-save">
            {busy ? 'Saving…' : site ? 'Save changes' : 'Create site'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Network editor modal (with CIDR validation feedback)
// ---------------------------------------------------------------------------

interface NetworkFormState {
  siteId: string;
  name: string;
  cidr: string;
  description: string;
  scanIntervalSeconds: string;
  deepScanIntervalSeconds: string;
  isEnabled: boolean;
}

function NetworkModal({
  network,
  sites,
  onClose,
  onSaved,
}: {
  network: NetworkInfo | null; // null = create
  sites: Site[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<NetworkFormState>(
    network
      ? {
          siteId: String(network.siteId),
          name: network.name,
          cidr: network.cidr,
          description: network.description ?? '',
          scanIntervalSeconds: String(network.scanIntervalSeconds),
          deepScanIntervalSeconds: String(network.deepScanIntervalSeconds),
          isEnabled: network.isEnabled,
        }
      : {
          siteId: sites[0] ? String(sites[0].id) : '',
          name: '',
          cidr: '',
          description: '',
          scanIntervalSeconds: '300',
          deepScanIntervalSeconds: '3600',
          isEnabled: true,
        },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cidrTouched = form.cidr.trim().length > 0;
  const cidrOk = isValidCidr(form.cidr);
  const valid = form.siteId !== '' && form.name.trim().length > 0 && cidrOk;

  const submit = async () => {
    setBusy(true);
    setError(null);
    const payload: NetworkPayload = {
      siteId: Number(form.siteId),
      name: form.name.trim(),
      cidr: form.cidr.trim(),
      description: form.description.trim(),
      scanIntervalSeconds: Number(form.scanIntervalSeconds) || 300,
      deepScanIntervalSeconds: Number(form.deepScanIntervalSeconds) || 3600,
    };
    try {
      if (network) await api.put(`/api/networks/${network.id}`, { ...payload, isEnabled: form.isEnabled });
      else await api.post('/api/networks', payload);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
      setBusy(false);
    }
  };

  return (
    <div className="nm-modal-backdrop" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="nm-modal settings-modal" role="dialog" aria-modal="true" data-testid="network-modal">
        <h5>{network ? `Edit ${network.name}` : 'New network'}</h5>
        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
        <div className="modal-form">
          <div>
            <label className="form-label">Site</label>
            <select className="form-select" value={form.siteId}
              onChange={(e) => setForm({ ...form, siteId: e.target.value })}>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="form-label">Name</label>
            <input className="form-control" value={form.name} placeholder="e.g. Office LAN"
              onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="network-name" />
          </div>
          <div className="span-2">
            <label className="form-label">CIDR range</label>
            <input
              className={`form-control mono${cidrTouched && !cidrOk ? ' is-invalid' : ''}`}
              value={form.cidr}
              placeholder="e.g. 192.168.10.0/24"
              onChange={(e) => setForm({ ...form, cidr: e.target.value })}
              data-testid="network-cidr"
            />
            {cidrTouched && !cidrOk ? (
              <div className="invalid-feedback d-block" data-testid="cidr-error">
                Not a valid IPv4 CIDR (expected e.g. 192.168.10.0/24).
              </div>
            ) : (
              <div className="form-text">This exact range is what nmap will target.</div>
            )}
          </div>
          <div className="span-2">
            <label className="form-label">Description</label>
            <input className="form-control" value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div>
            <label className="form-label">Quick scan interval (s)</label>
            <input className="form-control" type="number" min={60} value={form.scanIntervalSeconds}
              onChange={(e) => setForm({ ...form, scanIntervalSeconds: e.target.value })} />
          </div>
          <div>
            <label className="form-label">Deep scan interval (s)</label>
            <input className="form-control" type="number" min={300} value={form.deepScanIntervalSeconds}
              onChange={(e) => setForm({ ...form, deepScanIntervalSeconds: e.target.value })} />
          </div>
          {network && (
            <div className="span-2">
              <label className="form-check">
                <input type="checkbox" className="form-check-input" checked={form.isEnabled}
                  onChange={(e) => setForm({ ...form, isEnabled: e.target.checked })} />
                <span className="form-check-label">Scanning enabled</span>
              </label>
            </div>
          )}
        </div>
        <div className="nm-modal-actions mt-3">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn btn-accent" onClick={submit} disabled={!valid || busy} data-testid="network-save">
            {busy ? 'Saving…' : network ? 'Save changes' : 'Create network'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scan profile editor
// ---------------------------------------------------------------------------

function ProfileEditor({ networks }: { networks: NetworkInfo[] }) {
  const [networkId, setNetworkId] = useState('');
  const [savingType, setSavingType] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { nmapArgs: string; intervalSeconds: string; isEnabled: boolean }>>({});

  useEffect(() => {
    if (networkId === '' && networks.length > 0) setNetworkId(String(networks[0].id));
  }, [networks, networkId]);

  const detail = useAsync<NetworkInfo | null>(
    () => (networkId === '' ? Promise.resolve(null) : api.get<NetworkInfo>(`/api/networks/${networkId}`)),
    [networkId],
  );

  // Reset drafts when switching networks — stale edits must not bleed across.
  useEffect(() => setDrafts({}), [networkId]);

  const profiles: ScanProfile[] = detail.data?.scanProfiles ?? [];

  const draftFor = (p: ScanProfile) =>
    drafts[p.profileType] ?? { nmapArgs: p.nmapArgs, intervalSeconds: String(p.intervalSeconds), isEnabled: p.isEnabled };

  const save = async (p: ScanProfile) => {
    const draft = draftFor(p);
    setSavingType(p.profileType);
    setError(null);
    try {
      await api.put(`/api/networks/${networkId}/profiles/${p.profileType}`, {
        nmapArgs: draft.nmapArgs,
        intervalSeconds: Number(draft.intervalSeconds) || p.intervalSeconds,
        isEnabled: draft.isEnabled,
      });
      setDrafts((d) => {
        const next = { ...d };
        delete next[p.profileType];
        return next;
      });
      detail.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSavingType(null);
    }
  };

  return (
    <div className="nm-card">
      <div className="nm-card-header">
        Scan profiles
        <select
          className="form-select form-select-sm profile-network-select"
          value={networkId}
          onChange={(e) => setNetworkId(e.target.value)}
          aria-label="Network for profiles"
          data-testid="profile-network"
        >
          {networks.map((n) => (
            <option key={n.id} value={n.id}>{n.name} · {n.cidr}</option>
          ))}
        </select>
      </div>
      <div className="nm-card-body">
        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
        {detail.loading ? (
          <LoadingSpinner label="Loading profiles…" />
        ) : detail.error ? (
          <ErrorBanner message={detail.error} onRetry={detail.reload} />
        ) : profiles.length === 0 ? (
          <EmptyState icon="bi-sliders" title="No profiles" message="Pick a network to edit its scan profiles." />
        ) : (
          <div className="profile-rows">
            {profiles.map((p) => {
              const draft = draftFor(p);
              const dirty =
                draft.nmapArgs !== p.nmapArgs ||
                draft.intervalSeconds !== String(p.intervalSeconds) ||
                draft.isEnabled !== p.isEnabled;
              return (
                <div className="profile-row" key={p.profileType} data-testid={`profile-${p.profileType}`}>
                  <div className="profile-head">
                    <strong>{humanize(p.profileType)}</strong>
                    <span className="text-muted-token">every {formatDuration(Number(draft.intervalSeconds) || p.intervalSeconds)}</span>
                    <label className="form-check ms-auto mb-0">
                      <input type="checkbox" className="form-check-input" checked={draft.isEnabled}
                        onChange={(e) => setDrafts((d) => ({ ...d, [p.profileType]: { ...draft, isEnabled: e.target.checked } }))} />
                      <span className="form-check-label">enabled</span>
                    </label>
                  </div>
                  <div className="profile-controls">
                    <input
                      className="form-control mono"
                      value={draft.nmapArgs}
                      onChange={(e) => setDrafts((d) => ({ ...d, [p.profileType]: { ...draft, nmapArgs: e.target.value } }))}
                      aria-label={`nmap arguments for ${p.profileType}`}
                    />
                    <input
                      className="form-control interval-input"
                      type="number"
                      min={60}
                      value={draft.intervalSeconds}
                      onChange={(e) => setDrafts((d) => ({ ...d, [p.profileType]: { ...draft, intervalSeconds: e.target.value } }))}
                      aria-label={`Interval seconds for ${p.profileType}`}
                    />
                    <button type="button" className="btn btn-accent btn-sm" disabled={!dirty || savingType === p.profileType}
                      onClick={() => save(p)}>
                      {savingType === p.profileType ? '…' : 'Save'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

/**
 * Composes the independent panels above and owns only what spans them: the
 * sites and networks lists, and the modal/confirm state for editing both.
 *
 * Any mutation reloads sites *and* networks together, because the two are
 * coupled — a network can move between sites, and deleting a site cascades to
 * its networks, so refreshing one without the other leaves the page showing a
 * parent that no longer has the children listed under it.
 */
export default function Settings() {
  const sites = useAsync<Site[]>(() => api.get<Site[]>('/api/sites'), []);
  const networks = useAsync<NetworkInfo[]>(() => api.get<NetworkInfo[]>(`/api/networks${buildQuery({})}`), []);

  const [siteModal, setSiteModal] = useState<{ open: boolean; site: Site | null }>({ open: false, site: null });
  const [networkModal, setNetworkModal] = useState<{ open: boolean; network: NetworkInfo | null }>({ open: false, network: null });
  const [deleteSite, setDeleteSite] = useState<Site | null>(null);
  const [deleteNetwork, setDeleteNetwork] = useState<NetworkInfo | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [crudError, setCrudError] = useState<string | null>(null);

  const reloadInventory = () => {
    sites.reload();
    networks.reload();
  };

  const confirmDeleteSite = async () => {
    if (!deleteSite) return;
    setDeleteBusy(true);
    setCrudError(null);
    try {
      await api.del(`/api/sites/${deleteSite.id}`);
      setDeleteSite(null);
      reloadInventory();
    } catch (err) {
      setCrudError(err instanceof Error ? err.message : 'Delete failed');
      setDeleteSite(null);
    } finally {
      setDeleteBusy(false);
    }
  };

  const confirmDeleteNetwork = async () => {
    if (!deleteNetwork) return;
    setDeleteBusy(true);
    setCrudError(null);
    try {
      await api.del(`/api/networks/${deleteNetwork.id}`);
      setDeleteNetwork(null);
      reloadInventory();
    } catch (err) {
      setCrudError(err instanceof Error ? err.message : 'Delete failed');
      setDeleteNetwork(null);
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="settings-page" data-testid="settings-page">
      {crudError && <ErrorBanner message={crudError} onDismiss={() => setCrudError(null)} />}

      <div className="settings-grid">
        <SystemPanel />
        <AppSettingsPanel />
      </div>

      {/* ---- sites ---- */}
      <div className="nm-card mt-3">
        <div className="nm-card-header">
          Sites
          <button type="button" className="btn btn-accent btn-sm" onClick={() => setSiteModal({ open: true, site: null })} data-testid="add-site">
            <i className="bi bi-plus-lg me-1" />
            Add site
          </button>
        </div>
        {sites.loading ? (
          <LoadingSpinner label="Loading sites…" />
        ) : sites.error ? (
          <div className="nm-card-body"><ErrorBanner message={sites.error} onRetry={sites.reload} /></div>
        ) : (sites.data ?? []).length === 0 ? (
          <EmptyState icon="bi-buildings" title="No sites yet" message="A site is a place that owns networks — add one to start scanning." />
        ) : (
          <div className="nm-table-wrap">
            <table className="nm-table" data-testid="sites-table">
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Name</th>
                  <th>Location</th>
                  <th>Networks</th>
                  <th>Devices</th>
                  <th className="actions-col" />
                </tr>
              </thead>
              <tbody>
                {(sites.data ?? []).map((site) => (
                  <tr key={site.id}>
                    <td><span className="profile-chip">{site.siteKey}</span></td>
                    <td className="cell-primary">{site.name}</td>
                    <td>{site.city ? `${site.city}${site.state ? `, ${site.state}` : ''}` : '—'}</td>
                    <td>{site.networkCount ?? '—'}</td>
                    <td>{site.deviceCount ?? '—'}</td>
                    <td className="actions-col">
                      <button type="button" className="btn btn-sm btn-ghost me-1" onClick={() => setSiteModal({ open: true, site })}
                        aria-label={`Edit ${site.name}`}>
                        <i className="bi bi-pencil" />
                      </button>
                      <button type="button" className="btn btn-sm btn-danger-soft" onClick={() => setDeleteSite(site)}
                        aria-label={`Delete ${site.name}`} data-testid={`delete-site-${site.id}`}>
                        <i className="bi bi-trash" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ---- networks ---- */}
      <div className="nm-card mt-3">
        <div className="nm-card-header">
          Networks
          <button
            type="button"
            className="btn btn-accent btn-sm"
            onClick={() => setNetworkModal({ open: true, network: null })}
            disabled={(sites.data ?? []).length === 0}
            title={(sites.data ?? []).length === 0 ? 'Create a site first' : undefined}
            data-testid="add-network"
          >
            <i className="bi bi-plus-lg me-1" />
            Add network
          </button>
        </div>
        {networks.loading ? (
          <LoadingSpinner label="Loading networks…" />
        ) : networks.error ? (
          <div className="nm-card-body"><ErrorBanner message={networks.error} onRetry={networks.reload} /></div>
        ) : (networks.data ?? []).length === 0 ? (
          <EmptyState icon="bi-diagram-2" title="No networks yet" message="Add a CIDR range under a site; the five default scan profiles come with it." />
        ) : (
          <div className="nm-table-wrap">
            <table className="nm-table" data-testid="networks-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>CIDR</th>
                  <th>Scanning</th>
                  <th>Quick / deep cadence</th>
                  <th>Devices</th>
                  <th className="actions-col" />
                </tr>
              </thead>
              <tbody>
                {(networks.data ?? []).map((network) => (
                  <tr key={network.id}>
                    <td className="cell-primary">
                      {network.name}
                      {network.description && <div className="text-muted-token small">{network.description}</div>}
                    </td>
                    <td className="cell-mono">{network.cidr}</td>
                    <td>{network.isEnabled ? <StatusPill status="enabled" /> : <StatusPill status="down" />}</td>
                    <td>{formatDuration(network.scanIntervalSeconds)} / {formatDuration(network.deepScanIntervalSeconds)}</td>
                    <td>{network.deviceCount ?? '—'}</td>
                    <td className="actions-col">
                      <button type="button" className="btn btn-sm btn-ghost me-1" onClick={() => setNetworkModal({ open: true, network })}
                        aria-label={`Edit ${network.name}`}>
                        <i className="bi bi-pencil" />
                      </button>
                      <button type="button" className="btn btn-sm btn-danger-soft" onClick={() => setDeleteNetwork(network)}
                        aria-label={`Delete ${network.name}`}>
                        <i className="bi bi-trash" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ---- scan profiles ---- */}
      {(networks.data ?? []).length > 0 && (
        <div className="mt-3">
          <ProfileEditor networks={networks.data ?? []} />
        </div>
      )}

      {/* ---- modals ---- */}
      {siteModal.open && (
        <SiteModal
          site={siteModal.site}
          onClose={() => setSiteModal({ open: false, site: null })}
          onSaved={() => {
            setSiteModal({ open: false, site: null });
            reloadInventory();
          }}
        />
      )}
      {networkModal.open && (
        <NetworkModal
          network={networkModal.network}
          sites={sites.data ?? []}
          onClose={() => setNetworkModal({ open: false, network: null })}
          onSaved={() => {
            setNetworkModal({ open: false, network: null });
            reloadInventory();
          }}
        />
      )}

      <ConfirmDialog
        open={deleteSite !== null}
        title={`Delete site ${deleteSite?.name ?? ''}?`}
        message="This cascades: every network under the site, and every device, scan, and alert under those networks, is deleted with it."
        confirmLabel="Delete site"
        danger
        busy={deleteBusy}
        onConfirm={confirmDeleteSite}
        onCancel={() => setDeleteSite(null)}
      />
      <ConfirmDialog
        open={deleteNetwork !== null}
        title={`Delete network ${deleteNetwork?.name ?? ''}?`}
        message={`${deleteNetwork?.cidr ?? ''} and all of its devices and scan history will be removed.`}
        confirmLabel="Delete network"
        danger
        busy={deleteBusy}
        onConfirm={confirmDeleteNetwork}
        onCancel={() => setDeleteNetwork(null)}
      />
    </div>
  );
}
