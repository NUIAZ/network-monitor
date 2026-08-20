/**
 * Browser-side error reporting: ships client failures to the same
 * `exception_logs` table the API writes to, so one screen shows both tiers.
 *
 * Three rules shape this file, and all three exist because the reporter runs
 * *while the app is already broken*:
 *
 *  1. It uses raw `fetch`, never services/api.ts. The api wrapper is one of
 *     the things that can fail, and reporting a wrapper failure through the
 *     wrapper would re-enter the same code path, at best a duplicate error,
 *     at worst an unbounded loop of reports about reports.
 *  2. It is fire-and-forget. `reportError` returns void, never rejects, and
 *     never awaits anything on the UI's critical path. A logging endpoint
 *     being down must not be able to break a page that was otherwise fine.
 *  3. It de-duplicates. A component that throws inside render throws again on
 *     every retry/re-render; a render loop can fire hundreds of identical
 *     errors per second. Without a short-lived signature cache one bad commit
 *     writes thousands of identical rows and the log becomes unreadable
 *     exactly when it is needed most.
 */
import type { ClientErrorReport, ErrorLogLevel } from '../types';

/** The permissive 202 endpoint documented in docs/API.md, "Error logs". */
const ENDPOINT = '/api/logs/client-error';

/**
 * How long a signature suppresses repeats. Long enough to collapse a render
 * loop or a burst of failing polls, short enough that a fault which is still
 * happening a minute later gets a fresh row proving it never stopped.
 */
const DEDUPE_WINDOW_MS = 15_000;

/** Cap on tracked signatures so a page that throws endlessly can't leak memory. */
const MAX_TRACKED_SIGNATURES = 200;

/** Stack traces are trimmed before sending, the top frames carry the meaning. */
const MAX_STACK_CHARS = 8_000;

/** signature → timestamp of the report that claimed it. */
const recentSignatures = new Map<string, number>();

/** Guards against double-installing the global handlers (StrictMode, HMR). */
let handlersInstalled = false;

/** Optional overrides for a manual `reportError` call. */
export interface ReportOptions {
  /** Defaults to "error"; the ErrorBoundary reports "fatal". */
  level?: ErrorLogLevel;
  /** Correlation id when the caller knows it and the error object doesn't carry one. */
  correlationId?: string | null;
  /** Route to attribute the failure to; defaults to the current location. */
  path?: string;
}

/** djb2: a cheap, stable, non-cryptographic hash for building signatures. */
function hash(value: string): string {
  let h = 5381;
  for (let i = 0; i < value.length; i++) {
    h = ((h << 5) + h + value.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

/**
 * True when this signature has not been reported inside the dedupe window.
 * Expired entries are pruned on the way through, which keeps the map bounded
 * without needing a timer that would itself keep the page alive.
 */
function claimSignature(signature: string, now: number): boolean {
  for (const [key, at] of recentSignatures) {
    if (now - at > DEDUPE_WINDOW_MS) recentSignatures.delete(key);
  }
  if (recentSignatures.has(signature)) return false;
  // Hard cap as a backstop: if the window is full of live signatures, drop the
  // oldest rather than growing without bound.
  if (recentSignatures.size >= MAX_TRACKED_SIGNATURES) {
    const oldest = recentSignatures.keys().next();
    if (!oldest.done) recentSignatures.delete(oldest.value);
  }
  recentSignatures.set(signature, now);
  return true;
}

/** Normalizes anything throwable into the three fields the API wants. */
function describeError(error: unknown): { message: string; exceptionType: string; stackTrace: string | null } {
  if (error instanceof Error) {
    return {
      message: error.message || error.name || 'Unknown error',
      exceptionType: error.name || 'Error',
      stackTrace: error.stack ? error.stack.slice(0, MAX_STACK_CHARS) : null,
    };
  }
  // Non-Error throws are legal in JS and common in library code ("string
  // thrown", rejected promises carrying plain objects), record them anyway.
  if (typeof error === 'string') {
    return { message: error, exceptionType: 'String', stackTrace: null };
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(error) ?? String(error);
  } catch {
    serialized = String(error);
  }
  return { message: serialized.slice(0, 1_000), exceptionType: 'UnknownThrowable', stackTrace: null };
}

/**
 * Pulls the correlation id off an error object when one is there. ApiError
 * attaches it from a problem+json response body, which is what links a browser
 * row to the server row for the same incident.
 */
function correlationIdOf(error: unknown): string | null {
  if (error && typeof error === 'object' && 'correlationId' in error) {
    const value = (error as { correlationId?: unknown }).correlationId;
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}

/** The route the user was on, the single most useful piece of context. */
function currentPath(): string {
  if (typeof window === 'undefined') return '/';
  return `${window.location.pathname}${window.location.search}` || '/';
}

/**
 * Reports a failure. Safe to call from anywhere, including inside a catch
 * block that is already handling a broken state: it swallows every fault of
 * its own and returns immediately.
 */
export function reportError(error: unknown, options: ReportOptions = {}): void {
  try {
    const { message, exceptionType, stackTrace } = describeError(error);
    const signature = hash(`${exceptionType}|${message}|${stackTrace ?? ''}`);
    if (!claimSignature(signature, Date.now())) return;

    const payload: ClientErrorReport = {
      message,
      exceptionType,
      stackTrace,
      path: options.path ?? currentPath(),
      level: options.level ?? 'error',
      correlationId: options.correlationId ?? correlationIdOf(error),
    };

    // Raw fetch on purpose (see the file header). `keepalive` lets a report
    // survive the navigation or reload that often follows a crash.
    const request = fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    });
    // Not awaited: the caller is on a UI path and the outcome is unactionable.
    if (request && typeof request.catch === 'function') request.catch(() => {});
  } catch {
    // A reporter that throws would turn a handled error into an unhandled one.
  }
}

/**
 * Clears the dedupe cache. Exists for tests (each case needs a clean window)
 * and for the rare manual "report this again now" path.
 */
export function resetReportedErrors(): void {
  recentSignatures.clear();
}

/**
 * Installs the global handlers. Called once from main.tsx.
 *
 * Both handlers chain to whatever was already installed (Vite's dev overlay,
 * for instance): swallowing another handler's callback would trade error
 * visibility for error logging, which is a bad trade.
 */
export function init(): void {
  if (handlersInstalled || typeof window === 'undefined') return;
  handlersInstalled = true;

  const previousOnError = window.onerror;
  window.onerror = function onError(message, source, lineno, colno, error) {
    // `error` is absent for cross-origin script failures; the message string
    // is then all we get, and a bare "Script error." is still worth knowing.
    reportError(error ?? (typeof message === 'string' ? message : 'Unhandled error'));
    return previousOnError ? previousOnError.call(window, message, source, lineno, colno, error) : false;
  };

  const previousOnRejection = window.onunhandledrejection;
  window.onunhandledrejection = function onUnhandledRejection(event) {
    reportError(event.reason ?? 'Unhandled promise rejection');
    if (previousOnRejection) previousOnRejection.call(window, event);
  };
}
