/**
 * Neutral three-dot pulse loader. Used as the page-level suspense/loading
 * state and inline inside buttons ("sm" size) while a mutation is in flight.
 */
import './Shared.css';

interface LoadingSpinnerProps {
  /** Optional caption under the pulse (e.g. "Loading devices…"). */
  label?: string;
  /** Compact inline variant with no padding, for buttons and toolbars. */
  size?: 'sm' | 'md';
}

/**
 * The two sizes differ in more than padding: only "md" wraps the pulse in a
 * `role="status"` live region. The "sm" variant is bare because it sits inside
 * a button that is already announcing its own busy state, and nesting a second
 * live region there would make assistive tech say it twice.
 *
 * `label` is therefore ignored at "sm".
 */
export default function LoadingSpinner({ label, size = 'md' }: LoadingSpinnerProps) {
  const pulse = (
    <span className={`loading-pulse${size === 'sm' ? ' sm' : ''}`} data-testid="loading-spinner">
      <span />
      <span />
      <span />
    </span>
  );

  if (size === 'sm') return pulse;

  return (
    <div className="loading-wrap" role="status" aria-live="polite">
      {pulse}
      {label && <div>{label}</div>}
    </div>
  );
}
