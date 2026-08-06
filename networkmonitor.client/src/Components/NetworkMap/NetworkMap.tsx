/**
 * Network topology map — inline SVG, no chart library.
 *
 * Layout is deterministic and computed in one pass: each network's devices
 * sit on concentric rings sized so nodes never overlap; networks orbit their
 * site hub far enough apart that clusters can't collide; sites pack into
 * rows. Everything is then normalized into a fixed 1400×800 view space so
 * pan/zoom math is independent of both the data and the container size.
 *
 * Devices are colored by status and shaped by type — two independent facts,
 * two independent visual channels — with a legend for both. Hovering shows
 * the identity tooltip; clicking a device jumps to its detail page.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, buildQuery } from '../../services/api';
import { useAsync } from '../../hooks/useAsync';
import type { Site, TopologyDevice, TopologyNetwork, TopologyResponse, TopologySite } from '../../types';
import { deviceStatusColor } from '../../utils/deviceIcons';
import LoadingSpinner from '../Shared/LoadingSpinner';
import ErrorBanner from '../Shared/ErrorBanner';
import EmptyState from '../Shared/EmptyState';
import './NetworkMap.css';

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

const VIEW_W = 1400;
const VIEW_H = 800;
/** Minimum spacing between device nodes along a ring, in layout units. */
const NODE_SPACING = 22;

interface DevicePos {
  device: TopologyDevice;
  x: number;
  y: number;
}

interface NetworkPos {
  network: TopologyNetwork;
  x: number;
  y: number;
  radius: number;
  devices: DevicePos[];
}

interface SitePos {
  site: TopologySite;
  x: number;
  y: number;
  radius: number;
  networks: NetworkPos[];
}

/** Places one network's devices on concentric rings around (0,0). */
function layoutDevices(devices: TopologyDevice[]): { positions: DevicePos[]; radius: number } {
  const positions: DevicePos[] = [];
  let placed = 0;
  let ringRadius = 52;
  while (placed < devices.length) {
    // Ring capacity grows with circumference, so big networks spiral outward
    // instead of overlapping.
    const capacity = Math.max(6, Math.floor((2 * Math.PI * ringRadius) / NODE_SPACING));
    const onRing = Math.min(capacity, devices.length - placed);
    for (let i = 0; i < onRing; i++) {
      const angle = -Math.PI / 2 + (i / onRing) * 2 * Math.PI;
      positions.push({
        device: devices[placed + i],
        x: Math.cos(angle) * ringRadius,
        y: Math.sin(angle) * ringRadius,
      });
    }
    placed += onRing;
    ringRadius += 26;
  }
  return { positions, radius: devices.length === 0 ? 40 : ringRadius - 26 + 18 };
}

/** Full topology → positioned sites/networks/devices in raw layout space. */
function layoutTopology(sites: TopologySite[]): SitePos[] {
  const laidOut: SitePos[] = [];

  // First pass: each site laid out around its own origin.
  const prepared = sites.map((site) => {
    const networkLayouts = site.networks.map((network) => {
      const { positions, radius } = layoutDevices(network.devices);
      return { network, positions, radius };
    });

    const count = networkLayouts.length;
    const maxR = networkLayouts.reduce((m, n) => Math.max(m, n.radius), 40);
    // Orbit distance must satisfy both "clear of the hub" and "adjacent
    // clusters don't touch" (chord length between neighbors ≥ their radii).
    let orbit = maxR + 95;
    if (count > 1) {
      const needed = (2 * maxR + 40) / (2 * Math.sin(Math.PI / count));
      orbit = Math.max(orbit, needed);
    }
    // The site name is drawn just below the hub, so the ring must never place a
    // cluster due south — its own label would land on top of the site's. An even
    // number of clusters starting at due north always produces one at due south,
    // so even counts get a half-step rotation (2 networks become left/right
    // rather than above/below). Odd counts never hit south to begin with.
    const ringOffset = count > 0 && count % 2 === 0 ? Math.PI / count : 0;
    const networks: NetworkPos[] = networkLayouts.map((n, i) => {
      const angle = -Math.PI / 2 + ringOffset + (i / Math.max(count, 1)) * 2 * Math.PI;
      const cx = count === 0 ? 0 : Math.cos(angle) * orbit;
      const cy = count === 0 ? 0 : Math.sin(angle) * orbit;
      return {
        network: n.network,
        x: cx,
        y: cy,
        radius: n.radius,
        devices: n.positions.map((p) => ({ device: p.device, x: cx + p.x, y: cy + p.y })),
      };
    });

    const radius = count === 0 ? 80 : orbit + maxR + 60;
    return { site, networks, radius };
  });

  // Second pass: pack sites into rows of three.
  const GAP = 90;
  // Aim for a squarish arrangement rather than a fixed three-wide row: four
  // sites laid out 3+1 wastes most of the frame and shrinks every glyph once
  // the whole thing is scaled to fit. A 2x2 grid uses the space evenly.
  const perRow = prepared.length <= 4 ? Math.ceil(Math.sqrt(prepared.length)) : 3;
  let rowY = 0;
  for (let start = 0; start < prepared.length; start += perRow) {
    const row = prepared.slice(start, start + perRow);
    const rowHeight = Math.max(...row.map((s) => s.radius)) * 2;
    let x = 0;
    for (const s of row) {
      x += s.radius;
      const cy = rowY + rowHeight / 2;
      laidOut.push({
        site: s.site,
        x,
        y: cy,
        radius: s.radius,
        networks: s.networks.map((n) => ({
          ...n,
          x: n.x + x,
          y: n.y + cy,
          devices: n.devices.map((d) => ({ ...d, x: d.x + x, y: d.y + cy })),
        })),
      });
      x += s.radius + GAP;
    }
    rowY += rowHeight + GAP;
  }

  return laidOut;
}

/** Uniformly rescales the raw layout into the fixed 1400×800 view space. */
function normalize(sites: SitePos[]): SitePos[] {
  if (sites.length === 0) return sites;
  const minX = Math.min(...sites.map((s) => s.x - s.radius));
  const maxX = Math.max(...sites.map((s) => s.x + s.radius));
  const minY = Math.min(...sites.map((s) => s.y - s.radius));
  const maxY = Math.max(...sites.map((s) => s.y + s.radius));
  const margin = 30;
  const scale = Math.min(
    (VIEW_W - margin * 2) / Math.max(maxX - minX, 1),
    (VIEW_H - margin * 2) / Math.max(maxY - minY, 1),
    1.6, // don't blow a single tiny site up to cartoon size
  );
  const offsetX = (VIEW_W - (maxX - minX) * scale) / 2 - minX * scale;
  const offsetY = (VIEW_H - (maxY - minY) * scale) / 2 - minY * scale;
  const map = (x: number, y: number) => ({ x: x * scale + offsetX, y: y * scale + offsetY });
  return sites.map((s) => ({
    ...s,
    ...map(s.x, s.y),
    radius: s.radius * scale,
    networks: s.networks.map((n) => ({
      ...n,
      ...map(n.x, n.y),
      radius: n.radius * scale,
      devices: n.devices.map((d) => ({ ...d, ...map(d.x, d.y) })),
    })),
  }));
}

// ---------------------------------------------------------------------------
// Device glyphs — shape encodes type (independent of the status color).
// ---------------------------------------------------------------------------

function DeviceGlyph({ type, x, y, fill }: { type: string; x: number; y: number; fill: string }) {
  const stroke = 'var(--card-bg)';
  const common = { fill, stroke, strokeWidth: 1.4 } as const;
  switch (type) {
    case 'router': // diamond
      return <path d={`M ${x} ${y - 8} L ${x + 8} ${y} L ${x} ${y + 8} L ${x - 8} ${y} Z`} {...common} />;
    case 'switch': // wide bar
      return <rect x={x - 9} y={y - 5} width={18} height={10} rx={2} {...common} />;
    case 'firewall': // shield
      return <path d={`M ${x} ${y - 8} L ${x + 7} ${y - 5} L ${x + 7} ${y + 2} Q ${x + 7} ${y + 7} ${x} ${y + 9} Q ${x - 7} ${y + 7} ${x - 7} ${y + 2} L ${x - 7} ${y - 5} Z`} {...common} />;
    case 'server': // tall rect
      return <rect x={x - 6} y={y - 8} width={12} height={16} rx={2} {...common} />;
    case 'printer': // squat rect
      return <rect x={x - 7} y={y - 5} width={14} height={11} rx={2} {...common} />;
    case 'camera': // triangle
      return <path d={`M ${x} ${y - 8} L ${x + 8} ${y + 6} L ${x - 8} ${y + 6} Z`} {...common} />;
    case 'workstation':
      return <circle cx={x} cy={y} r={6.5} {...common} />;
    default: // unknown — dashed ring
      return <circle cx={x} cy={y} r={6} fill={fill} stroke={stroke} strokeWidth={1.4} strokeDasharray="2.5 2" />;
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

interface HoverState {
  device: TopologyDevice;
  networkName: string;
  x: number;
  y: number;
}

const MIN_ZOOM = 0.35;
const MAX_ZOOM = 6;

export default function NetworkMap() {
  const navigate = useNavigate();
  const [siteFilter, setSiteFilter] = useState('');
  const sites = useAsync<Site[]>(() => api.get<Site[]>('/api/sites'), []);
  const topology = useAsync<TopologyResponse>(
    () => api.get<TopologyResponse>(`/api/devices/topology${buildQuery({ siteId: siteFilter })}`),
    [siteFilter],
  );

  const layout = useMemo(() => normalize(layoutTopology(topology.data?.sites ?? [])), [topology.data]);

  // Pan/zoom transform on the inner <g>: view = pan + k · layout-point.
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
  const [hover, setHover] = useState<HoverState | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number; moved: boolean } | null>(null);

  /** Client px → view-space coords, honoring xMidYMid letterboxing. */
  const clientToView = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0, scale: 1 };
    const rect = svg.getBoundingClientRect();
    const scale = Math.min(rect.width / VIEW_W, rect.height / VIEW_H);
    const offsetX = (rect.width - VIEW_W * scale) / 2;
    const offsetY = (rect.height - VIEW_H * scale) / 2;
    return {
      x: (clientX - rect.left - offsetX) / scale,
      y: (clientY - rect.top - offsetY) / scale,
      scale,
    };
  }, []);

  const zoomAt = useCallback(
    (factor: number, clientX?: number, clientY?: number) => {
      setTransform((t) => {
        const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, t.k * factor));
        if (k === t.k) return t;
        // Zoom toward the cursor (or the view center for button zooms).
        const svg = svgRef.current;
        let px = VIEW_W / 2;
        let py = VIEW_H / 2;
        if (clientX !== undefined && clientY !== undefined && svg) {
          const v = clientToView(clientX, clientY);
          px = v.x;
          py = v.y;
        }
        return {
          k,
          x: px - (k / t.k) * (px - t.x),
          y: py - (k / t.k) * (py - t.y),
        };
      });
    },
    [clientToView],
  );

  const onWheel = useCallback(
    (e: React.WheelEvent<SVGSVGElement>) => {
      zoomAt(Math.exp(-e.deltaY * 0.0012), e.clientX, e.clientY);
    },
    [zoomAt],
  );

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, panX: transform.x, panY: transform.y, moved: false };
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const v = clientToView(e.clientX, e.clientY);
    const v0 = clientToView(drag.startX, drag.startY);
    const dx = v.x - v0.x;
    const dy = v.y - v0.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    setTransform((t) => ({ ...t, x: drag.panX + dx, y: drag.panY + dy }));
  };

  const onPointerUp = () => {
    // A tiny delay before clearing lets device onClick check "was this a drag".
    setTimeout(() => {
      dragRef.current = null;
    }, 0);
  };

  const onDeviceClick = (device: TopologyDevice) => {
    if (dragRef.current?.moved) return; // drag release over a node ≠ a click
    navigate(`/devices/${device.id}`);
  };

  const onDeviceHover = (e: React.MouseEvent, device: TopologyDevice, networkName: string) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHover({
      device,
      networkName,
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  const deviceTotal = layout.reduce(
    (sum, s) => sum + s.networks.reduce((n, net) => n + net.devices.length, 0),
    0,
  );

  return (
    <div data-testid="network-map-page">
      <div className="filter-row">
        <select
          className="form-select"
          value={siteFilter}
          onChange={(e) => { setSiteFilter(e.target.value); setTransform({ x: 0, y: 0, k: 1 }); }}
          aria-label="Filter by site"
          data-testid="map-site-filter"
        >
          <option value="">All sites</option>
          {(sites.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <div className="ms-auto map-zoom-controls">
          <button type="button" className="btn btn-ghost" onClick={() => zoomAt(1.35)} aria-label="Zoom in" data-testid="map-zoom-in">
            <i className="bi bi-plus-lg" />
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => zoomAt(1 / 1.35)} aria-label="Zoom out">
            <i className="bi bi-dash-lg" />
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setTransform({ x: 0, y: 0, k: 1 })} aria-label="Reset view">
            <i className="bi bi-arrows-fullscreen" />
          </button>
        </div>
      </div>

      {topology.error && <ErrorBanner message={topology.error} onRetry={topology.reload} />}

      <div className="nm-card map-card" ref={wrapRef}>
        {topology.loading ? (
          <LoadingSpinner label="Building topology…" />
        ) : layout.length === 0 ? (
          <EmptyState icon="bi-diagram-3" title="Nothing to map" message="Add a site and a network in Settings, then run a scan." />
        ) : (
          <>
            <svg
              ref={svgRef}
              className="map-svg"
              viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
              preserveAspectRatio="xMidYMid meet"
              onWheel={onWheel}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={() => { dragRef.current = null; setHover(null); }}
              data-testid="map-svg"
              role="img"
              aria-label={`Network topology: ${layout.length} sites, ${deviceTotal} devices`}
            >
              <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.k})`}>
                {/* edges under nodes */}
                {layout.map((site) =>
                  site.networks.map((network) => (
                    <g key={`edges-${network.network.id}`}>
                      <line x1={site.x} y1={site.y} x2={network.x} y2={network.y} className="edge-site" />
                      {network.devices.map((d) => (
                        <line key={d.device.id} x1={network.x} y1={network.y} x2={d.x} y2={d.y} className="edge-device" />
                      ))}
                    </g>
                  )),
                )}

                {/* network clusters */}
                {layout.map((site) =>
                  site.networks.map((network) => (
                    <g key={`net-${network.network.id}`}>
                      <circle cx={network.x} cy={network.y} r={network.radius} className="cluster-ring" />
                      <g className="network-hub">
                        <circle cx={network.x} cy={network.y} r={13} />
                        <text x={network.x} y={network.y - network.radius - 12} className="network-label" textAnchor="middle">
                          {network.network.name}
                        </text>
                        <text x={network.x} y={network.y - network.radius + 2} className="network-cidr" textAnchor="middle">
                          {network.network.cidr}
                        </text>
                      </g>
                      {network.devices.map((d) => (
                        <g
                          key={d.device.id}
                          className="device-node"
                          onClick={() => onDeviceClick(d.device)}
                          onMouseMove={(e) => onDeviceHover(e, d.device, network.network.name)}
                          onMouseLeave={() => setHover(null)}
                          data-testid={`map-device-${d.device.id}`}
                        >
                          {/* invisible fat hit target so small glyphs are hoverable */}
                          <circle cx={d.x} cy={d.y} r={12} fill="transparent" stroke="none" />
                          <DeviceGlyph type={d.device.deviceType} x={d.x} y={d.y} fill={deviceStatusColor(d.device.status)} />
                        </g>
                      ))}
                    </g>
                  )),
                )}

                {/* site hubs on top */}
                {layout.map((site) => (
                  <g key={`site-${site.site.id}`} className="site-hub">
                    <circle cx={site.x} cy={site.y} r={24} className="site-outer" />
                    <circle cx={site.x} cy={site.y} r={16} className="site-inner" />
                    <text x={site.x} y={site.y + 4.5} textAnchor="middle" className="site-glyph">⌂</text>
                    <text x={site.x} y={site.y + 46} textAnchor="middle" className="site-label">
                      {site.site.name}
                    </text>
                  </g>
                ))}
              </g>
            </svg>

            {/* hover tooltip (HTML overlay so it never scales with zoom) */}
            {hover && (
              <div
                className="map-tooltip"
                style={{ left: hover.x + 14, top: hover.y + 14 }}
                data-testid="map-tooltip"
              >
                <div className="tooltip-title mono">{hover.device.ip}</div>
                <div>{hover.device.hostname ?? 'no hostname'}</div>
                <div className="d-flex align-items-center gap-2">
                  <span className="dot" style={{ background: deviceStatusColor(hover.device.status) }} />
                  {hover.device.status} · {hover.device.deviceType} · {hover.networkName}
                </div>
              </div>
            )}

            {/* legend */}
            <div className="map-legend">
              <div className="legend-title">Status</div>
              <div><span className="dot" style={{ background: 'var(--success)' }} /> Online</div>
              <div><span className="dot" style={{ background: 'var(--error)' }} /> Offline</div>
              <div><span className="dot" style={{ background: 'var(--info)' }} /> New</div>
              <div className="legend-title mt-2">Shape = type</div>
              <svg width="150" height="92" viewBox="0 0 150 92" aria-hidden="true">
                <DeviceGlyph type="server" x={12} y={14} fill="var(--text-muted)" />
                <text x={28} y={18} className="legend-text">server</text>
                <DeviceGlyph type="router" x={12} y={38} fill="var(--text-muted)" />
                <text x={28} y={42} className="legend-text">router</text>
                <DeviceGlyph type="switch" x={12} y={62} fill="var(--text-muted)" />
                <text x={28} y={66} className="legend-text">switch</text>
                <DeviceGlyph type="firewall" x={12} y={84} fill="var(--text-muted)" />
                <text x={28} y={88} className="legend-text">firewall</text>
                <DeviceGlyph type="workstation" x={84} y={14} fill="var(--text-muted)" />
                <text x={98} y={18} className="legend-text">wkstn</text>
                <DeviceGlyph type="printer" x={84} y={38} fill="var(--text-muted)" />
                <text x={98} y={42} className="legend-text">printer</text>
                <DeviceGlyph type="camera" x={84} y={62} fill="var(--text-muted)" />
                <text x={98} y={66} className="legend-text">camera</text>
                <DeviceGlyph type="unknown" x={84} y={84} fill="var(--text-muted)" />
                <text x={98} y={88} className="legend-text">unknown</text>
              </svg>
            </div>
          </>
        )}
      </div>
      <div className="page-subtitle mt-2">
        Scroll to zoom · drag to pan · click a device to open it
      </div>
    </div>
  );
}
