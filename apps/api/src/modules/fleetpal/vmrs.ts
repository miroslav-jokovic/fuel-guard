import { fleetpalVmrsComponentSchema } from "@silvicom/shared";
import type { FleetpalClient } from "./client.js";
import { FleetpalError } from "./errors.js";

/**
 * VMRS component names, resolved live (FLEETPAL-INTEGRATION-PLAN.md F9c, D-FP8).
 *
 * ── ⚠ NOTHING HERE IS EVER WRITTEN TO A TABLE ──────────────────────────────────────────────────
 * The words are licensed TMC material, and the owner declined the distribution tier on 2026-09-10.
 * The code is a fact about a repair we performed; the description is the licensor's. So both are
 * fetched on demand, held in this process for an hour, and dropped — this module imports no Supabase
 * client, which is the assertion that matters, and its test proves the cache forgets.
 *
 * ── WHAT A REPAIR CARRIES IS AN ID, AND THE DEGRADED ANSWER IS THEREFORE NULL ─────────────────────
 * The plan wrote "a vendor failure degrades to the bare code". That assumed the staged `component`
 * was a code; it is the component's opaque id (`hovDtcRc`), and printing that is worse than printing
 * nothing. So a failure answers `null` for the id, and the screen falls back to the shop's own
 * free-text `description` of the repair — which every service-history row carries anyway.
 *
 * ── PER ID, NOT THE WHOLE TREE ────────────────────────────────────────────────────────────────────
 * A unit's year touches a few dozen components; the tree is thousands of nodes. One request per
 * distinct id not already cached, a few at a time, each on a short deadline with no retry — an
 * office user is waiting on the page, and an unresolved name is a degraded page, not a broken one.
 */

export interface ComponentLabel {
  code: string;
  description: string;
}

const TTL_MS = 60 * 60 * 1000;
/** Bounds memory against a long-lived process; Map iteration order makes the oldest go first. */
const MAX_ENTRIES = 5_000;
const CONCURRENCY = 6;

/**
 * Keyed by org AND id: FleetPal answers 404 for "another company's object" (errors.ts), and a
 * company may add its own codes beside the standard ones, so one org's answer is not another's.
 * A 404 is cached as `null` — asking again within the hour would get the same answer.
 */
const cache = new Map<string, { label: ComponentLabel | null; expires: number }>();

/** For tests only — the cache is process state and a test must not inherit the last one's. */
export function clearComponentCache(): void {
  cache.clear();
}

export async function describeComponents(
  client: FleetpalClient,
  orgId: string,
  ids: readonly string[],
  now: () => number = Date.now,
): Promise<Map<string, ComponentLabel | null>> {
  const out = new Map<string, ComponentLabel | null>();
  const missing: string[] = [];
  for (const id of new Set(ids)) {
    const hit = cache.get(`${orgId}:${id}`);
    if (hit && hit.expires > now()) out.set(id, hit.label);
    else missing.push(id);
  }

  for (let i = 0; i < missing.length; i += CONCURRENCY) {
    await Promise.all(
      missing.slice(i, i + CONCURRENCY).map(async (id) => {
        try {
          const c = await client.get(`/v1/vmrs-components/${encodeURIComponent(id)}/`, fleetpalVmrsComponentSchema);
          remember(orgId, id, { code: c.code, description: c.description }, now());
          out.set(id, { code: c.code, description: c.description });
        } catch (e) {
          // A 404 is an answer; anything else (outage, timeout, a dead key) is not, and is left
          // uncached so the next page view asks again rather than inheriting an hour of blanks.
          if (e instanceof FleetpalError && e.kind === "not_found") remember(orgId, id, null, now());
          out.set(id, null);
        }
      }),
    );
  }
  return out;
}

function remember(orgId: string, id: string, label: ComponentLabel | null, at: number): void {
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  cache.set(`${orgId}:${id}`, { label, expires: at + TTL_MS });
}
