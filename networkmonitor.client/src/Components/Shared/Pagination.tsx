/**
 * Server-paging footer: "N results" summary + prev/next + a numeric window.
 * The window is capped at five buttons with the current page centered, so the
 * control stays the same width whether there are 3 pages or 300.
 */
import { formatNumber } from '../../utils/format';
import './Shared.css';

interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
  /** Singular noun for the summary, e.g. "device" → "1,204 devices". */
  noun?: string;
}

/** Computes the visible page-number window (max 5, current centered). */
function pageWindow(page: number, totalPages: number): number[] {
  const size = Math.min(5, totalPages);
  let start = Math.max(1, page - Math.floor(size / 2));
  start = Math.min(start, Math.max(1, totalPages - size + 1));
  return Array.from({ length: size }, (_, i) => start + i);
}

/**
 * Renders nothing at all when there are no results, so callers can drop it
 * under any list without guarding — the empty state below the table is already
 * saying it. With exactly one page the summary still shows (the count is useful
 * on its own) but the buttons do not.
 *
 * `page` is 1-based, matching the API's paging envelope.
 */
export default function Pagination({ page, totalPages, total, onPageChange, noun = 'result' }: PaginationProps) {
  if (total <= 0) return null;
  const plural = total === 1 ? noun : `${noun}s`;

  return (
    <div className="nm-pagination" data-testid="pagination">
      <span data-testid="pagination-summary">
        {formatNumber(total)} {plural}
        {totalPages > 1 && ` · page ${page} of ${totalPages}`}
      </span>
      {totalPages > 1 && (
        <div className="page-buttons">
          <button
            type="button"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            aria-label="Previous page"
            data-testid="pagination-prev"
          >
            <i className="bi bi-chevron-left" />
          </button>
          {pageWindow(page, totalPages).map((p) => (
            <button
              type="button"
              key={p}
              className={p === page ? 'active' : ''}
              onClick={() => p !== page && onPageChange(p)}
              data-testid={`pagination-page-${p}`}
            >
              {p}
            </button>
          ))}
          <button
            type="button"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
            aria-label="Next page"
            data-testid="pagination-next"
          >
            <i className="bi bi-chevron-right" />
          </button>
        </div>
      )}
    </div>
  );
}
