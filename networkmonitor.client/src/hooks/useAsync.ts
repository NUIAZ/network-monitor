/**
 * Tiny data-loading hook standardizing the loading/error/reload trio every
 * page needs. Deliberately not a cache — this app's data is live monitoring
 * state, and showing stale devices as "online" is worse than a spinner.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * What a page gets back from useAsync. `T` is whatever the fetch function
 * resolves to — usually a DTO from types.ts, or a Paged<> envelope of one.
 */
export interface AsyncState<T> {
  /** Null until the first fetch resolves, and *retained* across a reload so a
   *  refresh does not blank the screen back to a spinner. */
  data: T | null;
  /** True during the very first load and during every reload. */
  loading: boolean;
  /** The ApiError message, already human-readable — safe to put straight on screen. */
  error: string | null;
  /** Re-runs the fetch (used by retry buttons and after mutations). */
  reload: () => void;
}

/**
 * Runs `fn` on mount and whenever `deps` change. Guards against out-of-order
 * resolution: when a refetch supersedes an in-flight request, the stale
 * response is dropped instead of clobbering newer data.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: readonly unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const runId = useRef(0);

  // The caller's inline lambda changes identity every render; keeping the
  // latest in a ref lets the effect depend only on the *declared* deps.
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    const id = ++runId.current;
    setLoading(true);
    setError(null);
    fnRef
      .current()
      .then((result) => {
        if (runId.current !== id) return;
        setData(result);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (runId.current !== id) return;
        setError(err instanceof Error ? err.message : 'Something went wrong');
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  return { data, loading, error, reload };
}
