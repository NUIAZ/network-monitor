/**
 * Rounded status chip with a colored dot. One component maps every lifecycle
 * vocabulary in the app (device status, scan status, interface oper-status)
 * onto the four status tones so the same word is always the same color.
 */
import { humanize } from '../../utils/format';
import './Shared.css';

/** status word → tone class. Anything unmapped renders neutral. */
const TONE_MAP: Record<string, string> = {
  online: 'success',
  completed: 'success',
  up: 'success',
  enabled: 'success',
  remediated: 'success',
  offline: 'error',
  failed: 'error',
  down: 'error',
  expired: 'error',
  open: 'warning',
  degraded: 'warning',
  accepted_risk: 'warning',
  new: 'info',
  running: 'info',
  testing: 'info',
};

/**
 * Takes the raw server string rather than a union, because it has to cover
 * three unrelated vocabularies at once and the server is free to add a word to
 * any of them. An unmapped or null status still renders — humanized, in the
 * neutral tone — so a new status word shows up as plain text instead of
 * vanishing from the row.
 */
export default function StatusPill({ status }: { status: string | null | undefined }) {
  const key = (status ?? '').toLowerCase();
  const tone = TONE_MAP[key];
  return (
    <span className={`status-pill${tone ? ` pill-${tone}` : ''}`} data-testid="status-pill" data-status={key}>
      <span className="dot" style={{ background: 'currentColor' }} />
      {humanize(status)}
    </span>
  );
}
