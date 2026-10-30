import { deriveFullName, type RosterHeldDriver, type RosterHeldReason, type TmsDriverInput } from "@silvicom/shared";

/**
 * The "needs a decision" list (ROSTER-LIFECYCLE-PLAN RL3), as pure functions. The write lives in
 * `tmsIngest.ts`, the module's one writer of `org_integrations`; the read in `rosterFreshness.ts`.
 *
 * ── WHY THE LIST IS MERGED, NOT REPLACED ─────────────────────────────────────────────────────────
 * One POST is not one sweep. The agent sends only CHANGED rows plus the ones the API asked for again
 * (`retry`), in batches of 1,000, and sends nothing on a sweep where neither exists. So a POST can only
 * speak for the drivers it CARRIES: each one it carries is settled now or held now, and every other entry
 * keeps the state the last POST that carried it gave it. Replacing the list wholesale would empty it on
 * the second batch of a large sweep, and keep a resolved driver on it forever after a quiet one.
 *
 * It stays correct because a held driver is always re-sent: every reason here is in `retry`
 * (`withRetry`), so the agent forgets its hash and carries it on the next sweep. That sweep settles it or
 * holds it again. The one way a held driver stops being sent is leaving McLeod's active list, which is
 * why the retire route clears departures from the list (`clearedByRetire`).
 */

/**
 * Which bucket wins when the ingest put an id in several: the most specific explanation first.
 * `fuel_card` MUST be last. It is not a bucket the ingest fills but the remainder of `retry`, which holds
 * every other reason too, so placed any earlier it would claim drivers that belong to a named one.
 */
const PRECEDENCE: readonly RosterHeldReason[] = ["rehire_review", "applicant", "ambiguous", "not_created", "fuel_card"];

export interface HeldIngestResult {
  unmatched: string[];
  ambiguous: string[];
  applicants: string[];
  retry: string[];
  rehireReview?: string[];
}

/** The drivers one ingest call held, each with the one reason that explains it. */
export function heldFromIngest(rows: readonly TmsDriverInput[], result: HeldIngestResult, now: string): RosterHeldDriver[] {
  const buckets: Record<RosterHeldReason, Set<string>> = {
    rehire_review: new Set(result.rehireReview ?? []),
    applicant: new Set(result.applicants),
    ambiguous: new Set(result.ambiguous),
    not_created: new Set(result.unmatched),
    // `retry` is every bucket above plus the fuel-card stand-off, which has no bucket of its own: the
    // ingest records it only as a retry (rosterIngest `skippedOwned` + `retry.push`). What is left of
    // `retry` once the named buckets are taken out is exactly that.
    fuel_card: new Set(result.retry),
  };
  const byId = new Map(rows.map((r) => [r.external_id, r]));
  const out: RosterHeldDriver[] = [];
  const seen = new Set<string>();
  for (const reason of PRECEDENCE) {
    for (const id of buckets[reason]) {
      if (seen.has(id)) continue;
      seen.add(id);
      const r = byId.get(id);
      const name = r ? deriveFullName({ first_name: r.first_name ?? null, middle_name: r.middle_name ?? null, last_name: r.last_name ?? null }) : "";
      out.push({ externalId: id, name: name || null, hireDate: r?.hire_date ?? null, reason, since: now });
    }
  }
  return out;
}

/**
 * The next list: every driver this POST carried is replaced by what it says now (held or gone); every
 * other entry stands. `since` survives while the reason is unchanged, so a list can say "waiting since".
 */
export function mergeHeld(previous: readonly RosterHeldDriver[], carried: readonly string[], held: readonly RosterHeldDriver[]): RosterHeldDriver[] {
  const spoken = new Set(carried);
  const before = new Map(previous.map((d) => [d.externalId, d]));
  const kept = previous.filter((d) => !spoken.has(d.externalId));
  const now = held.map((d) => {
    const prior = before.get(d.externalId);
    return prior && prior.reason === d.reason ? { ...d, since: prior.since } : d;
  });
  return [...kept, ...now].sort((a, b) => a.since.localeCompare(b.since) || a.externalId.localeCompare(b.externalId));
}

/** A driver McLeod reports inactive has left: whatever was held about them no longer needs a decision. */
export function clearedByRetire(previous: readonly RosterHeldDriver[], retiredIds: readonly string[]): RosterHeldDriver[] {
  const gone = new Set(retiredIds);
  return previous.filter((d) => !gone.has(d.externalId));
}
