/**
 * Friendly "nothing here" placeholder. Every list/table shows one of these
 * instead of a bare empty grid — a blank table reads as broken; an empty
 * state reads as truth.
 */
import type { ReactNode } from 'react';
import './Shared.css';

interface EmptyStateProps {
  /** bootstrap-icons class. */
  icon?: string;
  title: string;
  message?: string;
  /** Optional call-to-action button(s). */
  children?: ReactNode;
}

export default function EmptyState({ icon = 'bi-inbox', title, message, children }: EmptyStateProps) {
  return (
    <div className="empty-state" data-testid="empty-state">
      <i className={`bi ${icon}`} />
      <h5>{title}</h5>
      {message && <p>{message}</p>}
      {children}
    </div>
  );
}
