/**
 * Inline error strip with the server's message and an optional retry. Used
 * for both page-load failures and mutation failures, so users always see
 * *why* something failed rather than a dead screen.
 */
import './Shared.css';

interface ErrorBannerProps {
  message: string;
  onRetry?: () => void;
  onDismiss?: () => void;
}

/**
 * Carries `role="alert"`, so it is announced the moment it appears — mount it
 * when the failure happens rather than rendering it hidden and revealing it,
 * which would announce nothing.
 *
 * Both buttons are opt-in: a retry that cannot succeed and a dismiss that hides
 * an unresolved failure are each worse than no button.
 */
export default function ErrorBanner({ message, onRetry, onDismiss }: ErrorBannerProps) {
  return (
    <div className="error-banner" role="alert" data-testid="error-banner">
      <i className="bi bi-exclamation-triangle-fill" />
      <div className="flex-grow-1">{message}</div>
      {onRetry && (
        <button type="button" className="btn btn-sm btn-ghost" onClick={onRetry} data-testid="error-retry">
          <i className="bi bi-arrow-clockwise me-1" />
          Retry
        </button>
      )}
      {onDismiss && (
        <button type="button" className="btn btn-sm btn-ghost" onClick={onDismiss} aria-label="Dismiss">
          <i className="bi bi-x-lg" />
        </button>
      )}
    </div>
  );
}
