import type { WsPolicy } from "@silvicom/shared";
import type { Env } from "../env.js";
import type { EfsSoapCredentials } from "../services/efsSoapCredentials.js";
import { getPolicy, type CardOpOptions } from "./efsCardOps.js";

/**
 * A short-TTL cache in front of `getPolicy` (audit P1-1 second half / plan 2.1).
 *
 * Every card-detail render was a LIVE `getPolicy` round trip — one paced interactive call per page
 * view for a document that is shared by up to 99 cards and changes when a human changes it. N
 * operators browsing a fleet serialized behind each other in a 1 rps lane, and a policy the account
 * is not entitled to read was re-attempted (with retries, pre-2.1) on every single load: the
 * 15–20s card pages. The guide's own display note (p40) makes the policy HALF of every card render,
 * so this cache is load-bearing for the read product, not an optimisation.
 *
 * Failures are cached too, briefly: a policy that answers "Not Allowed" answers it for everyone,
 * and the page already renders without it (`read.ts` treats the policy as best-effort). Caching
 * the refusal for the same TTL turns a permanent refusal from one vendor call per page view into
 * one per ten minutes.
 *
 * Per-process, like the SOAP session cache next door: two API replicas hold two entries, which
 * costs one extra vendor call per replica per TTL and needs no shared infrastructure.
 * `invalidatePolicy` exists for the future setPolicy path (plan B4/Phase C) — nothing else may
 * write through this cache, because vendor truth only ever comes from the vendor.
 */

interface Entry {
  value: { ok: true; policy: WsPolicy } | { ok: false; message: string };
  expiresAt: number;
}

const cache = new Map<string, Entry>();
const keyOf = (orgId: string, policyNumber: number): string => `${orgId}:${policyNumber}`;

/** Test seam, and the credential-rotation hook: a changed EFS account must not serve old policies. */
export function __resetPolicyCache(): void {
  cache.clear();
}

export function invalidatePolicy(orgId: string, policyNumber?: number): void {
  if (policyNumber !== undefined) {
    cache.delete(keyOf(orgId, policyNumber));
    return;
  }
  for (const key of [...cache.keys()]) {
    if (key.startsWith(`${orgId}:`)) cache.delete(key);
  }
}

export async function getPolicyCached(
  env: Env,
  creds: EfsSoapCredentials,
  policyNumber: number,
  opts: CardOpOptions = {},
): Promise<{ policy: WsPolicy | null; policyError: string | null }> {
  const key = keyOf(creds.orgId, policyNumber);
  const ttl = env.EFS_POLICY_CACHE_MS;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return hit.value.ok
      ? { policy: hit.value.policy, policyError: null }
      : { policy: null, policyError: hit.value.message };
  }

  try {
    // retry:false — this sits on an interactive page render; a refusal is permanent and a blip is
    // answered on the NEXT page view, not by backoff sleeps a person sits through (guide p9: 4xx
    // semantics apply even when Axis2 wraps the refusal in HTTP 500).
    const policy = await getPolicy(env, creds, policyNumber, { retry: false, ...opts });
    cache.set(key, { value: { ok: true, policy }, expiresAt: Date.now() + ttl });
    return { policy, policyError: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read the policy";
    cache.set(key, { value: { ok: false, message }, expiresAt: Date.now() + ttl });
    return { policy: null, policyError: message };
  }
}
