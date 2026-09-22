import type { SupabaseClient } from "@supabase/supabase-js";
import { DRIVER_STATUSES, isInServiceVehicleStatus } from "@silvicom/shared";
import { readVehiclePositions } from "../samsara/index.js";
import { readRecentlyFuelledVehicleIds } from "../fuel/index.js";
import { writeAudit } from "../../lib/audit.js";

/**
 * Retirement (M6) — the only operation in this module that takes capability away from a person, and
 * the only one that touches the retention clock. It is separate from the identity sweep for that
 * reason: it runs when an operator asks for it, not as a side effect of refreshing a licence expiry.
 *
 * WHAT IT WILL NOT DO, and why each one is a rule rather than an oversight:
 *
 *  · **Never clears a termination date.** D-MR7. Once a driver has left, that date starts a §391.51
 *    retention clock and the evidence tables are append-only. A re-hire (McLeod clearing the date) is
 *    surfaced for a human, never applied — the same posture the Samsara sync has always taken, where
 *    reactivation is an admin decision.
 *  · **Never creates.** A retirement for a record we have never linked is meaningless; there is
 *    nothing to retire. Reported, ignored.
 *  · **Never touches a row the office or the recruiting pipeline owns.** `identity_source = 'manual'`
 *    is office-owned; `status = 'applicant'` belongs to recruiting, whose lifecycle guard (0213)
 *    exempts the service role, so nothing below us would object.
 *  · **Never retires more rows in one call than are currently active.** The bad-fetch guard, carried
 *    over verbatim from `samsaraDriverSync` where it was written after a thin response nearly
 *    deactivated a fleet. It matters more here: McLeod holds 1,299 non-active driver records against
 *    164 active ones, so a mis-scoped sweep has an eight-to-one lever on the roster.
 *  · **Never retires a truck that is plainly still working** — one the telematics feed saw in the
 *    last 24 hours, or one that bought diesel in the last 7 days (F6 widened by F14, below). The
 *    volume guard above catches a broken query; this one catches a WRONG one, which is the failure
 *    that actually happened, twice over: the retire predicate read `outservice_date`, a column this
 *    McLeod instance never clears, and nominated units 552, 555 and 569 while drivers were running
 *    them; and the reconcile read a MISSING McLeod link as absence and retired 33 vehicles on
 *    2026-09-14, 11 of them still fuelling.
 */

/**
 * ── THE LIVING-TRUCK GUARD (F6, widened by F14) ─────────────────────────────────────────────────
 * A retirement is a claim about the world: this truck is gone. Anything the truck did this week is
 * the world answering back, and the two cannot both be true. So a vehicle showing signs of life is
 * held out of the retirement and REPORTED — never silently retired, never silently dropped from the
 * report either.
 *
 * ⚠ **It shipped reading only telematics, and that was not enough.** On 2026-09-14 a reconcile sweep
 * retired 33 vehicles, 11 of them still fuelling. The one the carrier noticed was unit 732, whose
 * GATEWAY HAD BEEN SWAPPED a fortnight earlier — so the feed had nothing to say about it, while its
 * fuel card had eleven fills to offer, the most recent that same morning. A guard that reads one
 * signal is a guard against one failure. (§1.7b of the plan; the swap itself is §1.7a.)
 *
 * TWO SIGNALS, TWO WINDOWS, and the asymmetry is the point rather than an oversight:
 *
 *   · **a gateway reports continuously**, so 24 hours of silence is meaningful. Not one hour — the
 *     fleet parks overnight and over weekends, and a truck that has not reported since yesterday
 *     afternoon is a parked truck, not evidence of anything.
 *   · **a fuel card is used episodically.** A truck that fuels twice a week is silent for days at a
 *     time in perfect health, so 24 hours of no fills says nothing at all. Seven days is the shortest
 *     window in which an ordinary working truck is certain to have bought something.
 *
 * Both are deliberately NOT a veto on the whole sweep — one contradicted truck says nothing about the
 * other 458 — and neither is permanent: the truck is offered again on the next sweep, and once it
 * genuinely stops moving and stops fuelling it retires with no human in the loop.
 */
const FRESH_FIX_HOURS = 24;
const RECENT_FUEL_DAYS = 7;

/**
 * Vehicle ids that have done something recently enough to contradict a retirement.
 *
 * Both reads go through their owning module's interface rather than `.from()`: `vehicle_positions` is
 * `layer=raw, module=samsara` and `check-table-access.mjs` seals a raw table to its collector, while
 * `fuel_transactions` is fuel's table and a collector deciding things about another module's data is
 * how a schema becomes everybody's problem (D-ARC1/D-ARC3). Both edges — `mcleod -> samsara` and
 * `mcleod -> fuel` — are declared in `check-feature-boundaries.mjs` with their reasons.
 *
 * A fix whose timestamp does not parse is not counted as fresh. That direction is chosen knowingly:
 * the alternative — treating an unreadable timestamp as evidence of life — would let one malformed
 * row make the entire fleet permanently un-retirable, and the resulting hold would look exactly like
 * a healthy guard doing its job. `vehicle_positions.sampled_at` is `timestamptz` and PostgREST
 * renders it with a `+00:00` offset, which `Date.parse` reads correctly as it stands; the parse is
 * pinned by a test carrying that exact spelling, because appending a `Z` to it is how the weather
 * cache spent three weeks returning NaN (D-FC6). The fuel half has no such hazard — the comparison is
 * made by Postgres, against a timestamp we send it.
 */
async function vehiclesShowingLife(admin: SupabaseClient, orgId: string): Promise<Set<string>> {
  const now = Date.now();
  const alive = new Set<string>();

  const { rows } = await readVehiclePositions(admin, orgId);
  const fixCutoff = now - FRESH_FIX_HOURS * 60 * 60 * 1000;
  for (const row of rows) {
    const at = Date.parse(row.sampled_at);
    if (Number.isFinite(at) && at >= fixCutoff) alive.add(row.vehicle_id);
  }

  const fuelSince = new Date(now - RECENT_FUEL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { vehicleIds } = await readRecentlyFuelledVehicleIds(admin, orgId, fuelSince);
  for (const id of vehicleIds) alive.add(id);

  return alive;
}

export interface RetireInput {
  external_id: string;
  status: "inactive" | "terminated";
  termination_date?: string | null;
}

export interface RetireResult {
  received: number;
  retired: number;
  /** Already in the right state — the steady state once a roster has settled. */
  unchanged: number;
  /** Not linked to any Silvicom 360 row: nothing to retire. */
  unknown: string[];
  /** Left alone because the office or the recruiting pipeline owns the row. */
  skippedOwned: string[];
  /** McLeod cleared a termination date. Surfaced for a human; never applied. */
  rehires: string[];
  /** Vehicles held back because they are plainly still working — a fix inside `FRESH_FIX_HOURS` or a
   *  fill inside `RECENT_FUEL_DAYS` (F6/F14). External ids, so the operator reading the agent's
   *  report can look the contradiction up in McLeod directly. */
  heldMoving: string[];
  /** `externalId:message` for rows whose UPDATE was refused by the database. */
  failed: string[];
  /** Set when the whole call was refused by the bad-fetch guard, with the reason. */
  refused?: string;
}

const LINK = {
  drivers: "mcleod_driver_id",
  vehicles: "mcleod_tractor_id",
  trailers: "mcleod_trailer_id",
} as const;

type Entity = keyof typeof LINK;

interface Row {
  id: string;
  link: string;
  status: string | null;
  identity_source: string | null;
  termination_date?: string | null;
}

export async function retireFromTms(
  admin: SupabaseClient,
  orgId: string,
  entity: Entity,
  rows: RetireInput[],
): Promise<RetireResult> {
  const out: RetireResult = {
    received: rows.length,
    retired: 0,
    unchanged: 0,
    unknown: [],
    skippedOwned: [],
    rehires: [],
    heldMoving: [],
    failed: [],
  };
  const link = LINK[entity];

  const sel = entity === "drivers" ? `id, ${link}, status, identity_source, termination_date` : `id, ${link}, status, identity_source`;
  const { data, error } = await admin.from(entity).select(sel).eq("org_id", orgId).not(link, "is", null);
  if (error) throw new Error(error.message);
  const linked = ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    link: String(r[link]),
    status: (r.status as string | null) ?? null,
    identity_source: (r.identity_source as string | null) ?? null,
    termination_date: (r.termination_date as string | null) ?? null,
  })) as Row[];
  const byLink = new Map(linked.map((r) => [r.link, r]));

  // ── the bad-fetch guard ──────────────────────────────────────────────────────────────────────
  // Count what a full application of this payload would retire, and refuse the WHOLE call if that
  // exceeds the number of rows currently active. Refusing wholesale rather than trimming is the point:
  // a payload this large is not a big layoff, it is a broken query, and applying the first N of it
  // would be worse than applying none.
  // "Currently in the roster" is asked in each entity's own vocabulary. A driver is `active`; a truck
  // is anything `IN_SERVICE_VEHICLE_STATUSES` admits, which since 2026-09-22 includes the 12 McLeod
  // reports in a shop. Spelling `=== "active"` here would have shrunk the denominator by those 12 and
  // tightened the cap on a sweep that has nothing to do with them (the D-FC11 lesson, applied to the
  // one status comparison in this file that the E3 audit left — it converted line 191's, not this).
  const inRoster = (status: string | null): boolean =>
    entity === "drivers" ? status === "active" : isInServiceVehicleStatus(status);
  const active = linked.filter((r) => inRoster(r.status)).length;
  const wouldRetire = rows.filter((i) => inRoster(byLink.get(i.external_id)?.status ?? null)).length;
  // A single sweep may retire at most HALF the active roster, and always at least one row.
  //
  // Two earlier shapes were wrong and the failures were instructive. `wouldRetire > active` let a
  // payload empty the roster entirely. `wouldRetire >= active` caught that but refused the ordinary
  // case of a one-driver fleet losing its driver. The distinguishing feature of a bad fetch is not its
  // relation to the roster's edge, it is VOLUME: normal turnover retires a handful, a mis-scoped query
  // retires everything. McLeod holds 1,299 non-active driver records against 164 active ones, so the
  // lever is eight to one and the threshold has room to be generous.
  //
  // `Math.max(1, …)` keeps a tiny roster workable; the fraction keeps a real one safe.
  const cap = Math.max(1, Math.floor(active / 2));
  if (active > 0 && wouldRetire > cap) {
    out.refused =
      `would retire ${wouldRetire} of ${active} active ${entity} (cap ${cap}) — treating as a bad fetch`;
    return out;
  }

  // Only vehicles have a telematics fix to contradict the payload with. Read once for the batch: this
  // is one query for the whole sweep, against ~200 rows, and doing it per candidate would be a query
  // per truck for a guard that usually fires on none of them.
  const showingLife = entity === "vehicles" ? await vehiclesShowingLife(admin, orgId) : new Set<string>();

  for (const input of rows) {
    const row = byLink.get(input.external_id);
    if (!row) {
      out.unknown.push(input.external_id);
      continue;
    }
    if (row.identity_source === "manual" || row.status === "applicant") {
      out.skippedOwned.push(input.external_id);
      continue;
    }
    // Checked BEFORE the already-in-the-right-state test so a truck the feed contradicts is reported
    // every sweep, not just the first one. A held truck that has genuinely gone stops appearing here
    // as soon as its gateway does.
    if (showingLife.has(row.id)) {
      out.heldMoving.push(input.external_id);
      continue;
    }
    // A termination date already on the row is never unset, and never moved by a payload that has none.
    if (entity === "drivers" && row.termination_date && !input.termination_date) {
      out.rehires.push(input.external_id);
      continue;
    }
    /**
     * ── THE PAYLOAD'S WORD IS NOT THE ROW'S WORD ────────────────────────────────────────────────
     * `tmsRetireInputSchema` carries `inactive | terminated`, which is the vocabulary of somebody
     * LEAVING — right for a person, and not a word `vehicle_status` has ever contained. Until
     * 2026-09-22 this line wrote it into the column anyway: `vehicles.status` is a Postgres enum, so
     * every truck retirement failed with 22P02 and the error landed in `upErr`, which the old
     * `if (!upErr) out.retired++` discarded. The endpoint answered `retired: 0` and no failure, which
     * is indistinguishable from a sweep that had nothing to do — so this has been a silent no-op for
     * as long as it has existed, and no test looked (the suite covered drivers here and covered
     * vehicles only through `reconcileAbsentFromTms`, which maps correctly).
     *
     * Found while shipping F2, which changes WHICH trucks this endpoint is asked to retire; it would
     * have changed nothing at all without this.
     */
    const target = entity === "drivers" ? input.status : "retired";
    if (row.status === target) {
      out.unchanged++;
      continue;
    }
    // Equipment that is already out of the operating fleet has nothing to leave. An `ordered` truck
    // whose reservation McLeod cancelled lands here and is deliberately left alone — clearing a
    // reservation is F5/E6's question, and answering it as a side effect of a retirement sweep would
    // be this file deciding something the plan has not.
    if (entity !== "drivers" && !isInServiceVehicleStatus(row.status)) {
      out.unchanged++;
      continue;
    }

    const patch: Record<string, unknown> = { status: target };
    if (entity === "drivers" && input.termination_date && !row.termination_date) {
      patch.termination_date = input.termination_date;
    }
    // The vocabulary lives in shared and `drivers.status` has no CHECK constraint behind it until
    // 0240, so a mapping bug would otherwise write a novel status and every `status = 'active'` query
    // in the product would quietly exclude those rows.
    if (entity === "drivers" && !(DRIVER_STATUSES as readonly string[]).includes(input.status)) continue;

    const { error: upErr } = await admin.from(entity).update(patch).eq("id", row.id).eq("org_id", orgId);
    // Counted, never thrown — one bad row must not strand the rest of a sweep, the rule the 23505
    // branches in `rosterIngest` follow. But it is REPORTED: swallowing this error whole is what kept
    // the enum mismatch above invisible, and a write that failed must never read as a row that had
    // nothing to do.
    if (upErr) out.failed.push(`${input.external_id}:${upErr.message}`);
    else out.retired++;
  }
  return out;
}

/**
 * Reconcile a COMPLETE active McLeod roster. Unlike `retireFromTms`, this also handles legacy rows
 * that have no McLeod link because they were created by Samsara or EFS before McLeod became authoritative.
 * The caller must opt into `reconcile` mode; a normal identity sweep never infers retirement from absence.
 */
export async function reconcileAbsentFromTms(
  admin: SupabaseClient,
  orgId: string,
  entity: Entity,
  activeExternalIds: string[],
): Promise<{ retired: number; archived: number; heldMoving: string[]; refused?: string }> {
  if (activeExternalIds.length < 50) {
    return {
      retired: 0,
      archived: 0,
      heldMoving: [],
      refused: `refused roster reconciliation with only ${activeExternalIds.length} rows`,
    };
  }

  const link = LINK[entity];
  const select = entity === "drivers" ? `id, ${link}, status, archived_at, termination_date` : `id, ${link}, status`;
  const { data, error } = await admin.from(entity).select(select).eq("org_id", orgId);
  if (error) throw new Error(error.message);

  const activeSet = new Set(activeExternalIds);
  const candidates = ((data ?? []) as unknown as Record<string, unknown>[]).filter(
    (row) => !activeSet.has(String(row[link] ?? "")),
  );
  const changes: string[] = [];
  const heldMoving: string[] = [];
  let retired = 0;
  let archived = 0;

  // The same guard the payload path carries (F6), and this is the path that needs it MORE: absence is
  // a weaker claim than a nomination. A truck falls out of this reconciliation for any reason the
  // ACTIVE predicate is narrow — which is exactly what F1 just changed — and a telematics fix from
  // this morning is the one piece of evidence that outranks "McLeod did not mention it".
  const showingLife = entity === "vehicles" ? await vehiclesShowingLife(admin, orgId) : new Set<string>();

  for (const row of candidates) {
    const patch: Record<string, unknown> = {};
    if (showingLife.has(String(row.id))) {
      heldMoving.push(String(row.id));
      continue;
    }
    if (entity === "drivers") {
      if (row.status === "active") {
        patch.status = "terminated";
        if (!row.termination_date) patch.termination_date = new Date().toISOString().slice(0, 10);
        retired++;
      }
      if (!row.archived_at) {
        patch.archived_at = new Date().toISOString();
        archived++;
      }
      // `candidates` is `Record<string, unknown>` here, exactly as the `String(row[link] ?? "")`
      // above treats it; the cast is the same shape, not a new liberty.
    } else if (isInServiceVehicleStatus(row.status as string | null)) {
      /**
       * `=== "active"` until 2026-09-22, and that was a ONE-WAY TRAP waiting for its first
       * `maintenance` row. Nothing in this database had ever held one — the value has existed in
       * `vehicle_status` since 0001 and never been written — so a truck McLeod parks in a shop
       * would have become permanently un-retirable here: the sweep would decline to touch it, and
       * decline again every day after, silently, for as long as McLeod kept reporting it gone.
       *
       * The same applies to `ordered` in the other direction, and the predicate covers both by
       * asking the question the retire sweep actually means — "is this still part of the fleet?" —
       * rather than naming one of the statuses that answers yes (D-FC11, and the exclusion-list
       * lesson `EMPLOYED_DRIVER_STATUSES` records two doors down in the same constants file).
       */
      patch.status = "retired";
      retired++;
    }
    if (Object.keys(patch).length === 0) continue;
    const { error: updateError } = await admin.from(entity).update(patch).eq("id", row.id).eq("org_id", orgId);
    if (updateError) throw new Error(updateError.message);
    changes.push(String(row.id));
  }

  // A sweep that changed nothing BECAUSE the guard held everything is the most interesting run this
  // function can have — it is what a wrong predicate looks like from the inside — so `heldMoving`
  // alone is enough to make a record.
  if (changes.length > 0 || heldMoving.length > 0) {
    const recorded = await writeAudit(admin, {
      orgId,
      actorId: null,
      action: "mcleod.roster_reconciled",
      entity,
      // `heldMoving` rides in the audit row rather than only in the response: the response is read by
      // an agent on the carrier's network and then discarded, and a truck this sweep wanted to retire
      // while it was driving is the sort of contradiction somebody looks for weeks later.
      meta: { retired, archived, heldMoving, entityIds: changes, source: "mcleod_active_roster" },
    });
    if (!recorded) throw new Error(`Could not audit McLeod reconciliation for ${entity}`);
  }
  return { retired, archived, heldMoving };
}
