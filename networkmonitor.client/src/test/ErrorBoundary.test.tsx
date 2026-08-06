/**
 * ErrorBoundary: a page that throws during render must degrade into a
 * recoverable card — and must be reported, because a white screen the user
 * never mentions is a bug nobody fixes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ErrorBoundary from '../Components/Shared/ErrorBoundary';
import { resetReportedErrors } from '../services/errorLogger';

/** A child that always throws on render. */
function Exploding(): never {
  throw new Error('kaboom in render');
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    resetReportedErrors();
    // React logs caught render errors itself; silencing keeps the run readable.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders its children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <p>healthy page</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('healthy page')).toBeInTheDocument();
    expect(screen.queryByTestId('error-boundary')).toBeNull();
  });

  it('shows the recoverable fallback with both escape routes when a child throws', () => {
    render(
      <ErrorBoundary>
        <Exploding />
      </ErrorBoundary>,
    );

    expect(screen.getByTestId('error-boundary')).toBeInTheDocument();
    expect(screen.getByTestId('error-boundary')).toHaveTextContent('kaboom in render');
    expect(screen.getByTestId('error-boundary-reload')).toBeInTheDocument();
    expect(screen.getByTestId('error-boundary-home')).toHaveAttribute('href', '/');
  });

  it('reports the render crash at level "fatal"', () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <ErrorBoundary>
        <Exploding />
      </ErrorBoundary>,
    );

    expect(fetchMock).toHaveBeenCalled();
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/logs/client-error');
    const body = JSON.parse(options.body as string) as { level: string; message: string };
    expect(body.level).toBe('fatal');
    expect(body.message).toBe('kaboom in render');
  });
});
