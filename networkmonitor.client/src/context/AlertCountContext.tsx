/**
 * Shares the unacknowledged-alert count between the sidebar badge and the
 * pages that change it. The sidebar polls once a minute; any page that
 * acknowledges alerts calls refresh() so the badge drops immediately instead
 * of lying for up to a minute.
 */
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../services/api';
import type { Alert, Paged } from '../types';

interface AlertCountContextValue {
  count: number;
  refresh: () => void;
}

const AlertCountContext = createContext<AlertCountContextValue>({ count: 0, refresh: () => {} });

const POLL_MS = 60_000;

/**
 * Owns the badge count and the one-minute poll behind it. Must sit above both
 * the sidebar and the routed pages, since the point is that a page which
 * acknowledges alerts can push the badge down without waiting for the poll.
 *
 * Re-renders its subtree whenever the count changes, so keep it near the shell
 * rather than wrapping it around a single page.
 */
export function AlertCountProvider({ children }: { children: ReactNode }) {
  const [count, setCount] = useState(0);

  const refresh = useCallback(() => {
    // pageSize=1: we only want the `total` off the paging envelope, not rows.
    api
      .get<Paged<Alert>>('/api/alerts?acknowledged=false&pageSize=1')
      .then((page) => setCount(page.total))
      .catch(() => {
        // A failed badge poll is not worth an error banner — leave the last
        // known count and let the next poll self-heal.
      });
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  return <AlertCountContext.Provider value={{ count, refresh }}>{children}</AlertCountContext.Provider>;
}

/**
 * Reads the shared count, and hands back the `refresh` any page should call
 * after acknowledging alerts. Falls back to a count of 0 and a no-op refresh
 * when used outside the provider, so an isolated component (or a test) renders
 * rather than throwing — the badge is not worth a crash.
 */
export function useAlertCount(): AlertCountContextValue {
  return useContext(AlertCountContext);
}
