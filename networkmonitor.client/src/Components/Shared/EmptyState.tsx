/**
 * Friendly "nothing here" placeholder. Every list/table shows one of these
 * instead of a bare empty grid, a blank table reads as broken; an empty
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

/**
 * `title` is required on purpose: the whole point is saying which nothing this
 * is: "no devices yet" and "no devices match these filters" call for different
 * next actions, and a generic placeholder would blur them together.
 */
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
