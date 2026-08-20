/**
 * Thin typed wrapper over fetch for the NetworkMonitor API.
 *
 * Every page talks to the server through these four verbs so error handling
 * lives in exactly one place. The wrapper's one real job is turning an HTTP
 * failure into an ApiError whose message is worth putting on screen: the
 * server sends meaningful bodies (ProblemDetails, `{ message }`, or plain
 * text: e.g. the 503 "nmap is not installed" from POST /api/scans/run), and
 * a user staring at "Request failed" learns nothing.
 */

/** Error thrown for any non-2xx response, carrying the HTTP status code. */
export class ApiError extends Error {
  /** HTTP status code: pages branch on this (404 → not found, 503 → nmap missing). */
  readonly status: number;

  /**
   * Correlation id lifted out of an RFC 7807 problem+json body, when the
   * server sent one. errorLogger sends it back with the browser-side report so
   * the two rows describing one incident are findable by a single value
   * instead of by guessing from timestamps.
   */
  readonly correlationId: string | null;

  constructor(status: number, message: string, correlationId: string | null = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.correlationId = correlationId;
  }
}

/** What a failed response told us: something to show, and something to trace with. */
interface FailureDetail {
  message: string;
  correlationId: string | null;
}

/**
 * Extracts the most human-readable message a failed response has to offer,
 * plus the correlation id when the body is problem+json carrying one.
 * Tries JSON shapes first (ASP.NET ProblemDetails `title`/`detail`, custom
 * `{ message }` / `{ error }`), then raw text, then falls back to the status.
 */
async function extractError(response: Response): Promise<FailureDetail> {
  const fallback = `Request failed (${response.status} ${response.statusText})`;
  try {
    const text = await response.text();
    if (!text) return { message: fallback, correlationId: null };
    try {
      const body: unknown = JSON.parse(text);
      if (body && typeof body === 'object') {
        const record = body as Record<string, unknown>;
        // Read the id off any JSON error body rather than gating on the
        // content-type header: proxies rewrite content types, and an id that
        // is present is worth keeping regardless of how it was labelled.
        const rawId = record['correlationId'];
        const correlationId = typeof rawId === 'string' && rawId.length > 0 ? rawId : null;
        for (const key of ['message', 'detail', 'title', 'error']) {
          const value = record[key];
          if (typeof value === 'string' && value.trim().length > 0) {
            return { message: value, correlationId };
          }
        }
        return { message: fallback, correlationId };
      }
      return { message: fallback, correlationId: null };
    } catch {
      // Not JSON: a short plain-text body is usually the message itself.
      return { message: text.length <= 500 ? text : fallback, correlationId: null };
    }
  } catch {
    return { message: fallback, correlationId: null };
  }
}

/** Core request pipeline shared by all verbs. */
async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    // fetch itself only rejects on network-level failure (server down, DNS…).
    throw new ApiError(0, 'Cannot reach the server. Is the API running?');
  }

  if (!response.ok) {
    const { message, correlationId } = await extractError(response);
    throw new ApiError(response.status, message, correlationId);
  }

  // DELETEs and some POSTs legitimately return nothing.
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

/**
 * The four verbs every page calls. `del` defaults its type parameter to void
 * because the API answers deletes with 204; the others need an explicit `T`,
 * which is the DTO from types.ts that the endpoint documents.
 */
export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body),
  del: <T = void>(url: string) => request<T>('DELETE', url),
};

/**
 * Builds a query string from a params object, skipping null/undefined/empty
 * values so filter state maps straight to URLs without a wall of conditionals.
 * Returns '' or a string starting with '?'.
 */
export function buildQuery(
  params: Record<string, string | number | boolean | null | undefined>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}
