/**
 * Tiny data-loading hook standardizing the loading/error/reload trio every
 * page needs. Deliberately not a cache — this app's data is live monitoring
 * state, and showing stale devices as "online" is worse than a spinner.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
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
