/**
 * api wrapper: verb behavior, body/header handling, and — most importantly —
 * that server error messages actually surface on the thrown ApiError.
 */
import { describe, expect, it, vi } from 'vitest';
import { api, ApiError, buildQuery } from '../services/api';

function respond(status: number, body: string, contentType = 'application/json'): Response {
  return new Response(body, { status, headers: { 'Content-Type': contentType } });
}

describe('api wrapper', () => {
  it('parses JSON from a successful GET', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond(200, JSON.stringify({ hello: 'world' }))));
    await expect(api.get<{ hello: string }>('/api/x')).resolves.toEqual({ hello: 'world' });
  });

  it('sends a JSON body and content-type on POST', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond(200, '{}'));
    vi.stubGlobal('fetch', fetchMock);
    await api.post('/api/scans/run', { networkId: 3, profileType: 'quick' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/scans/run');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({ networkId: 3, profileType: 'quick' });
  });

  it('surfaces the server "message" field on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(respond(503, JSON.stringify({ message: 'nmap is not installed' }))),
    );
    const error = await api.post('/api/scans/run', {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(503);
    expect((error as ApiError).message).toBe('nmap is not installed');
  });

  it('surfaces ProblemDetails "title" when there is no message field', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(respond(400, JSON.stringify({ title: 'Invalid CIDR', status: 400 }))),
    );
    const error = await api.get('/api/networks/9').catch((e: unknown) => e);
    expect((error as ApiError).message).toBe('Invalid CIDR');
  });

  it('uses a short plain-text body as the error message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond(404, 'Device not found', 'text/plain')));
    const error = await api.get('/api/devices/999').catch((e: unknown) => e);
    expect((error as ApiError).message).toBe('Device not found');
    expect((error as ApiError).status).toBe(404);
  });

  it('turns network-level failure into a friendly ApiError with status 0', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    const error = await api.get('/api/x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(0);
  });

  it('captures the correlationId from an RFC 7807 problem+json body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        respond(
          500,
          JSON.stringify({ title: 'An unexpected error occurred', status: 500, correlationId: 'abc-123' }),
          'application/problem+json',
        ),
      ),
    );
    const error = await api.get('/api/devices').catch((e: unknown) => e);
    expect((error as ApiError).message).toBe('An unexpected error occurred');
    // errorLogger reads this off the error object when reporting the failure.
    expect((error as ApiError).correlationId).toBe('abc-123');
  });

  it('leaves correlationId null when the body has none', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond(400, JSON.stringify({ message: 'Bad input' }))));
    const error = await api.get('/api/x').catch((e: unknown) => e);
    expect((error as ApiError).correlationId).toBeNull();
  });

  it('returns undefined for 204 responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await expect(api.del('/api/alerts/1')).resolves.toBeUndefined();
  });
});

describe('buildQuery', () => {
  it('skips empty, null, and undefined values', () => {
    expect(buildQuery({ a: 1, b: '', c: null, d: undefined, e: 'x' })).toBe('?a=1&e=x');
  });

  it('returns an empty string when nothing survives', () => {
    expect(buildQuery({ a: '', b: undefined })).toBe('');
  });

  it('encodes values', () => {
    expect(buildQuery({ search: 'core switch' })).toBe('?search=core+switch');
  });
});
