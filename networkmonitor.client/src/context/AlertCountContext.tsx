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

export function useAlertCount(): AlertCountContextValue {
  return useContext(AlertCountContext);
}
