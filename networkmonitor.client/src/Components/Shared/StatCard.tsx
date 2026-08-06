/**
 * Dashboard stat tile: icon, big value, small label, optional sub-line.
 * Clickable tiles navigate to the filtered list behind the number — a stat
 * you can't drill into is just decoration.
 */
import type { ReactNode } from 'react';
import './Shared.css';

interface StatCardProps {
  /** bootstrap-icons class, e.g. "bi-hdd-network". */
  icon: string;
  label: string;
  value: ReactNode;
  /** Small secondary line under the label (e.g. "+4 in 24h"). */
  sub?: ReactNode;
  /** Icon tint; defaults to the informational blue. */
  tone?: 'accent' | 'success' | 'warning' | 'error' | 'info';
  onClick?: () => void;
  testId?: string;
}

export default function StatCard({ icon, label, value, sub, tone = 'accent', onClick, testId }: StatCardProps) {
  return (
    <div
      className={`stat-card tone-${tone}${onClick ? ' clickable' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick() : undefined}
      data-testid={testId ?? 'stat-card'}
    >
      <div className="stat-icon">
        <i className={`bi ${icon}`} />
      </div>
      <div className="min-w-0">
        <div className="stat-value" data-testid={testId ? `${testId}-value` : undefined}>{value}</div>
        <div className="stat-label">{label}</div>
        {sub && <div className="stat-sub">{sub}</div>}
      </div>
    </div>
  );
}
