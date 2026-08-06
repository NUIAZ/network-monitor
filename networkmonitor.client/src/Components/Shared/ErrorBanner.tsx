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
