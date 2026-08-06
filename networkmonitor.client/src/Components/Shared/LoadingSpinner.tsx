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
