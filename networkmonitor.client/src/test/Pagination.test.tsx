/**
 * Pagination: summary text, disabled edges, page-window behavior.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import Pagination from '../Components/Shared/Pagination';

describe('Pagination', () => {
  it('renders the total with a pluralized noun and page position', () => {
    render(<Pagination page={2} totalPages={5} total={120} onPageChange={() => {}} noun="device" />);
    expect(screen.getByTestId('pagination-summary')).toHaveTextContent('120 devices · page 2 of 5');
  });

  it('disables prev on the first page and next on the last', () => {
    const { rerender } = render(<Pagination page={1} totalPages={3} total={60} onPageChange={() => {}} />);
    expect(screen.getByTestId('pagination-prev')).toBeDisabled();
    expect(screen.getByTestId('pagination-next')).toBeEnabled();
    rerender(<Pagination page={3} totalPages={3} total={60} onPageChange={() => {}} />);
    expect(screen.getByTestId('pagination-next')).toBeDisabled();
  });

  it('invokes onPageChange with the clicked page number', () => {
    const onPageChange = vi.fn();
    render(<Pagination page={1} totalPages={5} total={100} onPageChange={onPageChange} />);
    fireEvent.click(screen.getByTestId('pagination-page-3'));
    expect(onPageChange).toHaveBeenCalledWith(3);
    fireEvent.click(screen.getByTestId('pagination-next'));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it('centers the window on the current page for long ranges', () => {
    render(<Pagination page={10} totalPages={40} total={1000} onPageChange={() => {}} />);
    for (const p of [8, 9, 10, 11, 12]) {
      expect(screen.getByTestId(`pagination-page-${p}`)).toBeInTheDocument();
    }
    expect(screen.queryByTestId('pagination-page-7')).toBeNull();
    expect(screen.getByTestId('pagination-page-10')).toHaveClass('active');
  });

  it('renders nothing at all for an empty result set', () => {
    const { container } = render(<Pagination page={1} totalPages={0} total={0} onPageChange={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
