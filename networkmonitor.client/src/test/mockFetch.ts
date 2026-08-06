/**
 * Tiny fetch mocker for component tests: match request URLs by substring and
 * answer with canned JSON. Unmatched URLs resolve to an empty object rather
 * than rejecting, so an incidental background call (e.g. the sidebar's
 * version lookup) can't fail an unrelated test.
 */
import { vi } from 'vitest';

export function mockFetchRoutes(routes: Record<string, unknown>): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const match = Object.entries(routes).find(([fragment]) => url.includes(fragment));
    const body = match ? match[1] : {};
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
