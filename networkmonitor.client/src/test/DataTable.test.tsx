/**
 * DataTable: client-side sorting toggling, empty state, and loading state.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import DataTable from '../Components/Shared/DataTable';
import type { Column } from '../Components/Shared/DataTable';

interface Row {
  id: number;
  name: string;
  score: number;
}

const rows: Row[] = [
  { id: 1, name: 'bravo', score: 30 },
  { id: 2, name: 'alpha', score: 10 },
  { id: 3, name: 'charlie', score: 20 },
];

const columns: Column<Row>[] = [
  { key: 'name', header: 'Name', sortable: true },
  { key: 'score', header: 'Score', sortable: true },
];

function cellTexts(): string[] {
  return screen.getAllByTestId('data-table-row').map((tr) => tr.querySelector('td')!.textContent!);
}

describe('DataTable (uncontrolled / client sorting)', () => {
  it('renders rows unsorted until a header is clicked', () => {
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} />);
    expect(cellTexts()).toEqual(['bravo', 'alpha', 'charlie']);
  });

  it('sorts ascending on first click and toggles to descending on second', () => {
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} />);
    const header = screen.getByTestId('data-table-header-name');
    fireEvent.click(header);
    expect(cellTexts()).toEqual(['alpha', 'bravo', 'charlie']);
    expect(header).toHaveAttribute('aria-sort', 'ascending');
    fireEvent.click(header);
    expect(cellTexts()).toEqual(['charlie', 'bravo', 'alpha']);
    expect(header).toHaveAttribute('aria-sort', 'descending');
  });

  it('sorts numeric columns numerically', () => {
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} />);
    fireEvent.click(screen.getByTestId('data-table-header-score'));
    const scores = screen.getAllByTestId('data-table-row').map((tr) => tr.querySelectorAll('td')[1].textContent);
    expect(scores).toEqual(['10', '20', '30']);
  });

  it('honors defaultSort on first render', () => {
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} defaultSort={{ key: 'score', dir: 'desc' }} />);
    expect(cellTexts()).toEqual(['bravo', 'charlie', 'alpha']);
  });

  it('reports sort changes instead of sorting when controlled', () => {
    const onSortChange = vi.fn();
    render(
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        sort={{ key: 'name', dir: 'asc' }}
        onSortChange={onSortChange}
      />,
    );
    // Controlled mode trusts the server's order — rows stay as given.
    expect(cellTexts()).toEqual(['bravo', 'alpha', 'charlie']);
    fireEvent.click(screen.getByTestId('data-table-header-name'));
    expect(onSortChange).toHaveBeenCalledWith({ key: 'name', dir: 'desc' });
  });

  it('shows the empty state when there are no rows', () => {
    render(<DataTable columns={columns} rows={[]} rowKey={(r: Row) => r.id} emptyTitle="Nothing found" />);
    expect(screen.getByTestId('empty-state')).toHaveTextContent('Nothing found');
  });

  it('shows the loading spinner instead of rows while loading', () => {
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} loading />);
    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();
    expect(screen.queryAllByTestId('data-table-row')).toHaveLength(0);
  });
});
