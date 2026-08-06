/**
 * Presentation-only formatting helpers.
 *
 * Everything here is pure and side-effect free so it can be unit tested
 * without a DOM. Dates arrive from the API as ISO-8601 strings (UTC); these
 * helpers render them in the viewer's local time zone, because "when did this
 * device go offline" is a question people answer in their own clock.
 */

/** Parses an ISO string defensively; returns null for absent/garbage input. */
function parse(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "Aug 5, 2026" — date only, for columns where the time would be noise. */
export function formatDate(value: string | null | undefined): string {
  const d = parse(value);
  if (!d) return '—';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** "Aug 5, 2026, 2:14 PM" — full timestamp for detail panels and tooltips. */
export function formatDateTime(value: string | null | undefined): string {
  const d = parse(value);
  if (!d) return '—';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * "just now", "5m ago", "3h ago", "2d ago" — the alert-feed style. Past a
 * week, relative time stops being meaningful and we fall back to the date.
 */
export function relativeTime(value: string | null | undefined, now: Date = new Date()): string {
  const d = parse(value);
  if (!d) return '—';
  const seconds = Math.floor((now.getTime() - d.getTime()) / 1000);
  if (seconds < 0) return formatDateTime(value);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(value);
}

/**
 * "45s", "3m 20s", "1h 12m" — scan durations. Sub-minute keeps seconds
 * because quick scans finish in seconds and "0m" would look broken.
 */
export function formatDuration(totalSeconds: number | null | undefined): string {
  if (totalSeconds === null || totalSeconds === undefined || totalSeconds < 0) return '—';
  const s = Math.round(totalSeconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 === 0 ? `${m}m` : `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return m % 60 === 0 ? `${h}h` : `${h}h ${m % 60}m`;
}

/** "1 Gbps", "100 Mbps" — interface speeds from SNMP ifSpeed (bits/second). */
export function formatBps(bps: number | null | undefined): string {
  if (!bps || bps <= 0) return '—';
  if (bps >= 1_000_000_000) return `${trimZero(bps / 1_000_000_000)} Gbps`;
  if (bps >= 1_000_000) return `${trimZero(bps / 1_000_000)} Mbps`;
  if (bps >= 1_000) return `${trimZero(bps / 1_000)} Kbps`;
  return `${bps} bps`;
}

function trimZero(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return rounded % 1 === 0 ? String(Math.round(rounded)) : rounded.toFixed(1);
}

/** "42%" / "3.5%" — utilization display with one decimal only when it matters. */
export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${trimZero(value)}%`;
}

/** "1,204" — thousands separators for stat tiles. */
export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return value.toLocaleString();
}

/** "accepted_risk" → "Accepted risk" — display form for enum-ish API strings. */
export function humanize(value: string | null | undefined): string {
  if (!value) return '—';
  const spaced = value.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Client-side CIDR sanity check mirroring the server's validation, so the
 * Settings form can flag a typo before the round trip. IPv4 dotted quad + /0–32.
 */
export function isValidCidr(value: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(value.trim());
  if (!match) return false;
  const octets = match.slice(1, 5).map(Number);
  const prefix = Number(match[5]);
  return octets.every((o) => o >= 0 && o <= 255) && prefix >= 0 && prefix <= 32;
}
