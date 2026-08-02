import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import type { PersistQueryClientProviderProps } from '@tanstack/react-query-persist-client';

/**
 * Read-cache persistence (plan §13.2, "final persister choice").
 *
 * DECISION: **AsyncStorage persister**, not a SQLite one. The read cache holds only what the driver
 * may already see (their own driver row, vehicles, loads) and is rebuilt from the server on demand,
 * so it does not need the SQLCipher treatment the outbox gets (D12) — the outbox is different
 * because it holds not-yet-synced work that exists nowhere else. Keeping the persister simple also
 * keeps restore-on-launch fast, which is what the cold-start-offline requirement actually needs.
 *
 * `throttleTime` batches writes so a burst of query updates doesn't thrash the disk.
 */
const CACHE_KEY = 'fuelguard.driver.query-cache';
const WEEK = 7 * 24 * 60 * 60 * 1000;

export const queryPersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: CACHE_KEY,
  throttleTime: 1000,
});

export const persistOptions: PersistQueryClientProviderProps['persistOptions'] = {
  persister: queryPersister,
  maxAge: WEEK, // a cache older than a week is stale enough to re-fetch rather than trust
  // Bump when a cached query's shape changes so old payloads are dropped instead of mis-parsed.
  buster: 'v1',
};
