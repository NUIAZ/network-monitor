/**
 * Minimal confirm modal (custom, not Bootstrap JS, we ship Bootstrap CSS
 * only). Used before destructive actions: deleting sites/networks/devices,
 * acknowledging every alert at once.
 */
import { useEffect } from 'react';
import './Shared.css';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  /** Styles the confirm button red for destructive actions. */
  danger?: boolean;
  /** Disables buttons while the confirmed action is running. */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Kept mounted and gated on `open` rather than conditionally rendered by the
 * caller, so the Escape listener can be wired to the same lifecycle as the
 * dialog. While `busy`, both the backdrop click and the buttons are inert;
 * a destructive action already in flight must not be cancellable or repeatable.
 *
 * Nothing here traps focus, so it is a confirm prompt rather than a full modal.
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  // Escape closes: standard dialog affordance people expect.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="nm-modal-backdrop"
      onClick={(e) => {
        // Backdrop click cancels, but clicks inside the dialog must not.
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
      data-testid="confirm-dialog"
    >
      <div className="nm-modal" role="dialog" aria-modal="true" aria-label={title}>
        <h5>{title}</h5>
        <p>{message}</p>
        <div className="nm-modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy} data-testid="confirm-cancel">
            Cancel
          </button>
          <button
            type="button"
            className={`btn ${danger ? 'btn-danger-soft' : 'btn-accent'}`}
            onClick={onConfirm}
            disabled={busy}
            data-testid="confirm-accept"
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
