/**
 * Device-type → icon/color lookups used by the device table, detail page,
 * dashboard donut, and topology map, so a "router" looks like the same thing
 * on every screen.
 */

/** bootstrap-icons class per classified device type. */
const TYPE_ICONS: Record<string, string> = {
  router: 'bi-sign-turn-right',
  switch: 'bi-diagram-3',
  firewall: 'bi-shield-shaded',
  printer: 'bi-printer',
  server: 'bi-hdd-rack',
  workstation: 'bi-pc-display',
  camera: 'bi-camera-video',
  unknown: 'bi-question-circle',
};

/**
 * Case-insensitive, and falls through to the "unknown" glyph for anything it
 * does not recognise: including null. The classifier's vocabulary can grow on
 * the server before this map catches up, and an unfamiliar type should render
 * as a question mark rather than as a hole in the table.
 */
export function deviceTypeIcon(deviceType: string | null | undefined): string {
  return TYPE_ICONS[(deviceType ?? 'unknown').toLowerCase()] ?? TYPE_ICONS.unknown;
}

/**
 * Chart-series slot per device type. Uses the validated categorical order so
 * the donut and map legend inherit CVD-safe adjacency for free.
 */
const TYPE_CHART_VARS: Record<string, string> = {
  server: 'var(--chart-1)',
  workstation: 'var(--chart-2)',
  switch: 'var(--chart-3)',
  printer: 'var(--chart-4)',
  camera: 'var(--chart-5)',
  router: 'var(--chart-6)',
  firewall: 'var(--chart-7)',
  unknown: 'var(--chart-8)',
};

/**
 * Returns a `var(--chart-N)` reference rather than a literal colour, so the
 * donut and the map re-skin themselves along with the rest of the page when the
 * theme changes. Unrecognised types share the last slot with "unknown".
 */
export function deviceTypeColor(deviceType: string | null | undefined): string {
  return TYPE_CHART_VARS[(deviceType ?? 'unknown').toLowerCase()] ?? 'var(--chart-8)';
}

/** Device status → status-token color, for map nodes and sparkline dots. */
export function deviceStatusColor(status: string | null | undefined): string {
  switch ((status ?? '').toLowerCase()) {
    case 'online':
      return 'var(--success)';
    case 'offline':
      return 'var(--error)';
    case 'new':
      return 'var(--info)';
    default:
      return 'var(--text-muted)';
  }
}
