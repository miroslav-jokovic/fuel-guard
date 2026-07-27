import { QueryClient } from '@tanstack/react-query';

/**
 * The single QueryClient, configured for the cab (plan §13.2 / D4).
 *
 *  • networkMode 'offlineFirst' — run the queryFn even when offline so cached data is served and a
 *    real attempt happens the moment signal returns; never park queries in a permanent "paused" state.
 *  • long staleTime/gcTime — driver context changes rarely, and a shift can run for hours with no
 *    signal; the cache must survive it (and a relaunch, via the persister).
 *  • retry skips 4xx — a 401/403/404 will not fix itself by retrying; network/5xx will.
 */
const DAY = 24 * 60 * 60 * 1000;

/** HTTP statuses worth retrying: none (network error), timeouts, rate limits, and server faults. */
export function isRetryableStatus(status: number | undefined): boolean {
  if (status === undefined || status === 0) return true; // network / timeout — retry
  if (status === 408 || status === 425 || status === 429) return true;
  return status >= 500;
}

/** Error thrown by query functions so react-query can see the HTTP status. */
export class ApiQueryError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, status: number, code = 'error') {
    super(message);
    this.name = 'ApiQueryError';
    this.status = status;
    this.code = code;
  }
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      networkMode: 'offlineFirst',
      staleTime: 5 * 60 * 1000,
      gcTime: 7 * DAY,
      refetchOnReconnect: true,
      refetchOnWindowFocus: true,
      retry: (failureCount, error) => {
        if (failureCount >= 3) return false;
        if (error instanceof ApiQueryError) return isRetryableStatus(error.status);
        return true;
      },
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30_000),
    },
    mutations: {
      networkMode: 'offlineFirst',
      // Domain writes do NOT retry here — they go through the durable outbox (src/data/sync.ts),
      // which owns retry/backoff and survives a relaunch. React Query retries would double up.
      retry: 0,
    },
  },
});
