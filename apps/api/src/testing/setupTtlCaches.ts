import { beforeEach } from "vitest";
import { resetTtlCaches } from "../lib/ttlCache.js";

/**
 * Every test starts with the request caches empty (lib/ttlCache.ts, Q-CHAT14).
 *
 * The module entitlement and the surface claim are cached for 15 s per process. In a test file that is
 * one process, so without this a test that turns a module off after an earlier test read it on would
 * get the earlier answer. That is a correct cache and a wrong test. Global for the reason
 * `setupOutboundDns.ts` gives: the next file would forget. It imports only the registry, so it never
 * loads a module a test means to `vi.mock`.
 */
beforeEach(() => {
  resetTtlCaches();
});
