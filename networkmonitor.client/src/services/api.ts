/**
 * Thin typed wrapper over fetch for the NetworkMonitor API.
 *
 * Every page talks to the server through these four verbs so error handling
 * lives in exactly one place. The wrapper's one real job is turning an HTTP
 * failure into an ApiError whose message is worth putting on screen: the
 * server sends meaningful bodies (ProblemDetails, `{ message }`, or plain
 * text — e.g. the 503 "nmap is not installed" from POST /api/scans/run), and
 * a user staring at "Request failed" learns nothing.
 */

/** Error thrown for any non-2xx response, carrying the HTTP status code. */
export class ApiError extends Error {
  /** HTTP status code — pages branch on this (404 → not found, 503 → nmap missing). */
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * Extracts the most human-readable message a failed response has to offer.
 * Tries JSON shapes first (ASP.NET ProblemDetails `title`/`detail`, custom
 * `{ message }` / `{ error }`), then raw text, then falls back to the status.
 */
async function extractError(response: Response): Promise<string> {
  const fallback = `Request failed (${response.status} ${response.statusText})`;
  try {
    const text = await response.text();
    if (!text) return fallback;
    try {
      const body: unknown = JSON.parse(text);
      if (body && typeof body === 'object') {
        const record = body as Record<string, unknown>;
        for (const key of ['message', 'detail', 'title', 'error']) {
          const value = record[key];
          if (typeof value === 'string' && value.trim().length > 0) return value;
        }
      }
      return fallback;
    } catch {
      // Not JSON — a short plain-text body is usually the message itself.
      return text.length <= 500 ? text : fallback;
    }
  } catch {
    return fallback;
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
    throw new ApiError(response.status, await extractError(response));
  }

  // DELETEs and some POSTs legitimately return nothing.
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

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
