import { ADS_AUTHORITY, type AdsAct, type AdsAuthority } from "@silvicom/shared";

/**
 * Run `fn` with one row of the ads authority table changed, then put it back (V5, Q-APX21). For the tests that
 * prove a door READS the table rather than restating it: the table is a plain object, so the running app sees the
 * change. Never used outside tests.
 */
export async function withAuthority<T>(act: AdsAct, who: readonly AdsAuthority[], fn: () => Promise<T>): Promise<T> {
  const table = ADS_AUTHORITY as unknown as Record<AdsAct, readonly AdsAuthority[]>;
  const before = table[act];
  table[act] = who;
  try {
    return await fn();
  } finally {
    table[act] = before;
  }
}
