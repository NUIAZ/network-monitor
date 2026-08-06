/**
 * Generic sortable table.
 *
 * Two sorting modes, chosen by the props you pass:
 *  - Controlled (server-side): pass `sort` + `onSortChange`; header clicks
 *    just report the requested sort and the parent refetches.
 *  - Uncontrolled (client-side): omit them and the table sorts its own rows
 *    using `sortValue` (or the raw field when the column key matches a
 *    primitive property).
 *
 * Loading and empty states render inside the table body so the header —
 * and therefore the layout — never jumps while data changes underneath.
 */
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import LoadingSpinner from './LoadingSpinner';
import EmptyState from './EmptyState';
import './Shared.css';

export interface SortState {
  key: string;
  dir: 'asc' | 'desc';
}

export interface Column<T> {
  key: string;
  header: string;
  sortable?: boolean;
  /** Custom cell renderer; defaults to the raw field value for the key. */
  render?: (row: T) => ReactNode;
  /** Value used for client-side sorting when `render` hides the raw value. */
  sortValue?: (row: T) => string | number | null;
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  loading?: boolean;
  onRowClick?: (row: T) => void;
  /** Controlled sort (server-side paging). */
  sort?: SortState;
  onSortChange?: (sort: SortState) => void;
  /** Initial sort for uncontrolled (client-side) mode. */
  defaultSort?: SortState;
  emptyTitle?: string;
  emptyMessage?: string;
  emptyIcon?: string;
  testId?: string;
}

/** Pulls a sortable primitive out of a row for a column. */
function rawValue<T>(row: T, column: Column<T>): string | number | null {
  if (column.sortValue) return column.sortValue(row);
  const value = (row as Record<string, unknown>)[column.key];
  if (typeof value === 'string' || typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return null;
}

export default function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  onRowClick,
  sort,
  onSortChange,
  defaultSort,
  emptyTitle = 'Nothing here',
  emptyMessage,
  emptyIcon,
  testId = 'data-table',
}: DataTableProps<T>) {
  const controlled = onSortChange !== undefined;
  const [localSort, setLocalSort] = useState<SortState | undefined>(defaultSort);
  const activeSort = controlled ? sort : localSort;

  const handleHeaderClick = (column: Column<T>) => {
    if (!column.sortable) return;
    const next: SortState =
      activeSort?.key === column.key
        ? { key: column.key, dir: activeSort.dir === 'asc' ? 'desc' : 'asc' }
        : { key: column.key, dir: 'asc' };
    if (controlled) onSortChange(next);
    else setLocalSort(next);
  };

  // Client-side sort only applies in uncontrolled mode — in controlled mode
  // the server already returned rows in order and re-sorting would lie about it.
  const displayRows = useMemo(() => {
    if (controlled || !localSort) return rows;
    const column = columns.find((c) => c.key === localSort.key);
    if (!column) return rows;
    const factor = localSort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = rawValue(a, column);
      const vb = rawValue(b, column);
      if (va === null && vb === null) return 0;
      if (va === null) return 1; // nulls always sink to the bottom
      if (vb === null) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * factor;
      return String(va).localeCompare(String(vb), undefined, { numeric: true }) * factor;
    });
  }, [rows, columns, controlled, localSort]);

  return (
    <div className="nm-table-wrap">
      <table className="nm-table" data-testid={testId}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                className={`${column.sortable ? 'sortable' : ''} ${column.className ?? ''}`.trim() || undefined}
                onClick={() => handleHeaderClick(column)}
                aria-sort={
                  activeSort?.key === column.key
                    ? activeSort.dir === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : undefined
                }
                data-testid={`${testId}-header-${column.key}`}
              >
                {column.header}
                {column.sortable && activeSort?.key === column.key && (
                  <i className={`bi sort-arrow ${activeSort.dir === 'asc' ? 'bi-caret-up-fill' : 'bi-caret-down-fill'}`} />
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={columns.length}>
                <LoadingSpinner label="Loading…" />
              </td>
            </tr>
          ) : displayRows.length === 0 ? (
            <tr>
              <td colSpan={columns.length}>
                <EmptyState icon={emptyIcon} title={emptyTitle} message={emptyMessage} />
              </td>
            </tr>
          ) : (
            displayRows.map((row) => (
              <tr
                key={rowKey(row)}
                className={onRowClick ? 'clickable' : undefined}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                data-testid={`${testId}-row`}
              >
                {columns.map((column) => (
                  <td key={column.key} className={column.className}>
                    {column.render
                      ? column.render(row)
                      : ((row as Record<string, unknown>)[column.key] as ReactNode) ?? '—'}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
