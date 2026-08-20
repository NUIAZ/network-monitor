/**
 * errorLogger: the guarantees the rest of the app relies on, one row per
 * distinct failure (not one per render), a payload the API can store, and a
 * reporter that can never make a bad situation worse by throwing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../services/api';
import { init, reportError, resetReportedErrors } from '../services/errorLogger';
import type { ClientErrorReport } from '../types';

/** The JSON body of the Nth fetch call, typed as the report contract. */
function bodyOf(fetchMock: ReturnType<typeof vi.fn>, index = 0): ClientErrorReport {
  const [, options] = fetchMock.mock.calls[index] as [string, RequestInit];
  return JSON.parse(options.body as string) as ClientErrorReport;
}

function stubFetch(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('errorLogger', () => {
  beforeEach(() => {
    resetReportedErrors();
  });

  it('posts the failure to the client-error endpoint with the expected shape', () => {
    const fetchMock = stubFetch();
    const error = new TypeError('cannot read properties of undefined');

    reportError(error, { level: 'fatal', path: '/devices/42' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/logs/client-error');
    expect(options.method).toBe('POST');

    const body = bodyOf(fetchMock);
    expect(body.message).toBe('cannot read properties of undefined');
    expect(body.exceptionType).toBe('TypeError');
    expect(body.stackTrace).toBeTruthy();
    expect(body.path).toBe('/devices/42');
    expect(body.level).toBe('fatal');
  });

  it('reports the same error only once inside the dedupe window', () => {
    const fetchMock = stubFetch();
    // A render loop throws an identical error every frame; the log must show
    // one row for that, not one row per frame.
    const boom = new Error('render loop');
    boom.stack = 'Error: render loop\n  at Widget';

    reportError(boom);
    reportError(boom);
    reportError(boom);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('still reports genuinely different errors', () => {
    const fetchMock = stubFetch();
    const first = new Error('first');
    first.stack = 'Error: first\n  at A';
    const second = new Error('second');
    second.stack = 'Error: second\n  at B';

    reportError(first);
    reportError(second);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(bodyOf(fetchMock, 0).message).toBe('first');
    expect(bodyOf(fetchMock, 1).message).toBe('second');
  });

  it('never throws when fetch rejects or is missing', async () => {
    const rejecting = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', rejecting);
    expect(() => reportError(new Error('while offline'))).not.toThrow();

    // Give the rejected promise a turn: an unhandled rejection here would fail
    // the run, which is the whole point of the internal .catch().
    await Promise.resolve();

    resetReportedErrors();
    vi.stubGlobal('fetch', vi.fn(() => {
      throw new Error('fetch exploded synchronously');
    }));
    expect(() => reportError(new Error('while broken'))).not.toThrow();
  });

  it('sends the correlation id an ApiError carries back to the server', () => {
    const fetchMock = stubFetch();

    reportError(new ApiError(500, 'Internal server error', 'abc-123'));

    expect(bodyOf(fetchMock).correlationId).toBe('abc-123');
  });

  it('handles non-Error throwables without losing the report', () => {
    const fetchMock = stubFetch();

    reportError('a bare string was thrown');

    const body = bodyOf(fetchMock);
    expect(body.message).toBe('a bare string was thrown');
    expect(body.exceptionType).toBe('String');
    expect(body.stackTrace).toBeNull();
  });

  it('reports through the global window.onerror handler installed by init()', () => {
    init();
    const fetchMock = stubFetch();

    window.onerror?.('Uncaught boom', 'app.js', 1, 1, new Error('uncaught boom'));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bodyOf(fetchMock).message).toBe('uncaught boom');
  });

  it('reports through the global unhandledrejection handler', () => {
    init();
    const fetchMock = stubFetch();

    // jsdom has no PromiseRejectionEvent constructor, so the handler is
    // invoked with the only field it reads.
    const event = { reason: new Error('rejected promise') } as PromiseRejectionEvent;
    window.onunhandledrejection?.(event);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bodyOf(fetchMock).message).toBe('rejected promise');
  });
});
