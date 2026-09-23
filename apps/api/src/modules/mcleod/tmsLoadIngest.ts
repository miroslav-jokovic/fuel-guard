import type { SupabaseClient } from "@supabase/supabase-js";
import {
  unitResolver,
  driverResolver,
  type KeyResolver,
  type UnitRow,
  type DriverKeyRow,
} from "./entityLookup.js";
import {
  applyCancels,
  applyOverwrites,
  insertCreates,
  stampExternalStatus,
  writeEvents,
  writePayloads,
  writeStops,
  type EventRow,
} from "./tmsLoadIngestWriters.js";
import { knownDispatcherIds } from "./tmsDispatcherIngest.js";
import {
  AMENDABLE_LOAD_FIELDS,
  tmsMayOverwrite,
  type LoadStatus,
  type TmsLoadInput,
  type TmsLoadResult,
} from "@silvicom/shared";

/**
 * TMS → dispatchable loads (Phase 3E, decision D48).
 *
 * `tmsIngest.ts` already receives MOVEMENTS, which exist to answer one question for reefer alerting:
 * was this a temperature-controlled trip? This file receives the other thing McLeod knows — the
 * actual dispatchable work, with a driver, stops, appointment windows and proof-of-work
 * expectations — and writes it into the same `loads` / `load_stops` tables a human uses.
 *
 * TWO RULES MAKE THIS SAFE, and they are the whole reason 3B built an approval gate first:
 *
 *   1. An ingested load lands in `pending_approval`, never `offered`. A feed cannot put work on a
 *      driver's phone; only a human releasing it can. `auto_approve_loads` lets a carrier opt out of
 *      review once the field mapping is trusted, and turning that on is itself audited.
 *   2. Once dispatch has approved a load, the feed STOPS WRITING and starts REPORTING. A re-sync that
 *      would change an approved load writes an `amended` event carrying the diff, for a human to
 *      apply or dismiss. Silently overwriting an approved load is how a driver ends up at the wrong
 *      dock holding paperwork nobody can reconcile.
 *
 * SHAPE (L11, 2026-09-17): this runs in two phases — **classify every load purely and in memory,
 * then issue one statement per table**. It used to interleave decisions with writes, six round trips
 * per load, which measured 52.1 seconds for a 157-load board. The classification is where rule 2
 * lives, so it is deliberately computed BEFORE any write: a bulk write that decided ownership as it
 * went is exactly how an approved load would get overwritten. See `tmsLoadIngestWriters.ts`.
 */

/**
 * Strip a `hazmat` key that only exists because `withNulls` turned an absent value into null.
 *
 * `loads.hazmat` is NOT NULL DEFAULT false. Every other field in the insert payload is nullable, so
 * collapsing undefined → null is right for them and wrong for this one — Postgres rejects the null
 * instead of applying the default. Pinned by "omits hazmat from the insert when the feed did not
 * send it, so the column default applies".
 */
function omitUndefinedHazmat(
  row: Record<string, unknown>,
  sent: boolean | undefined,
): Record<string, unknown> {
  if (sent !== undefined) return row;
  const { hazmat: _dropped, ...rest } = row;
  return rest;
}

export interface LoadIngestResult {
  received: number;
  created: number;
  amended: number;
  canceled: number;
  /** Match keys (unit numbers / employee ids) we could not resolve — reported, never silently dropped. */
  unmatched: string[];
  /**
   * Dispatcher ids a load named that `tms_dispatchers` does not hold yet. Reported, never refused:
   * the column has no foreign key on purpose (0344), so one account the roster has not carried
   * cannot fail a board.
   */
  unknownDispatchers: string[];
  results: TmsLoadResult[];
}

async function lookup(
  admin: SupabaseClient,
  table: "vehicles" | "trailers",
  orgId: string,
): Promise<KeyResolver> {
  const { data } = await admin.from(table).select("id, unit_number").eq("org_id", orgId);
  // Trailers normalise the reefer prefix McLeod does not use (D-FG8) — a raw compare drops ~44 of
  // this carrier's trailers, and a load with no trailer is a load with no reefer context.
  return unitResolver((data ?? []) as UnitRow[], table);
}

async function driverLookup(admin: SupabaseClient, orgId: string): Promise<KeyResolver> {
  const { data } = await admin
    .from("drivers")
    .select("id, employee_id, mcleod_driver_id")
    .eq("org_id", orgId);
  // `mcleod_driver_id` is the key that actually exists. `employee_id` is populated on 0 of 271
  // production rows, so before D-FG7 every McLeod load resolved to a null driver and said so only in
  // an unmatched list nobody was reading.
  return driverResolver((data ?? []) as DriverKeyRow[]);
}

/** Does this org want ingested loads released without review? Off unless explicitly enabled (D48). */
async function autoApproves(admin: SupabaseClient, orgId: string, provider: string): Promise<boolean> {
  const { data } = await admin
    .from("org_integrations")
    .select("config")
    .eq("org_id", orgId)
    .eq("provider", provider)
    .maybeSingle();
  const config = (data as { config?: Record<string, unknown> } | null)?.config ?? {};
  return config.auto_approve_loads === true;
}

interface ExistingLoad {
  id: string;
  status: LoadStatus;
  ref: string;
  equipment: string | null;
  commodity: string | null;
  hazmat: boolean;
  driver_id: string | null;
  vehicle_id: string | null;
  trailer_id: string | null;
}

/**
 * What we decided to do with one incoming load, decided before anything is written.
 *
 * `outcome` is the caller-facing word and is filled in here so the reported order always matches the
 * order the feed sent, whatever order the writes then happen in.
 */
type Decision =
  | { kind: "skip"; result: TmsLoadResult }
  | { kind: "cancel"; priorId: string; from: LoadStatus; result: TmsLoadResult }
  | { kind: "create"; input: TmsLoadInput; row: Record<string, unknown>; result: TmsLoadResult }
  | {
      kind: "own";
      priorId: string;
      input: TmsLoadInput;
      patch: Record<string, unknown>;
      result: TmsLoadResult;
    }
  | {
      kind: "report";
      priorId: string;
      input: TmsLoadInput;
      event: Record<string, unknown> | null;
      result: TmsLoadResult;
    };

/**
 * Decide, for every load, what happens to it — with no I/O at all.
 *
 * Rule 2 of the header lives in here. Because nothing is written while this runs, there is no path
 * on which a load's ownership is re-evaluated halfway through a batch.
 */
function classify(
  loads: TmsLoadInput[],
  existing: Map<string, ExistingLoad>,
  resolvers: { drivers: KeyResolver; vehicles: KeyResolver; trailers: KeyResolver },
  autoApprove: boolean,
  orgId: string,
  provider: string,
  syncedAt: string,
  unmatched: Set<string>,
): Decision[] {
  const status: LoadStatus = autoApprove ? "approved" : "pending_approval";

  return loads.map((input): Decision => {
    /**
     * `undefined` means the feed said NOTHING about this field — not that it was cleared. The
     * distinction matters: a sync that omits driver info would otherwise read as "dispatch's driver
     * was removed" and raise a false amendment on every poll. `null` is an explicit clear.
     */
    const resolve = (key: string | null | undefined, by: KeyResolver): string | null | undefined => {
      if (key === undefined) return undefined;
      if (key === null) return null;
      const hit = by.get(key);
      if (!hit) unmatched.add(key);
      return hit ?? null;
    };

    // `undefined` is preserved throughout: it means the feed said nothing about this field, which is
    // different from clearing it. Only the insert path collapses undefined to null (a new row has
    // nothing to preserve).
    //
    // ⚠ `hazmat` JOINED that rule on 2026-09-10 (D-LM12) and its schema default was removed with it.
    // It used to always carry a value, so a feed omitting it asserted "not placarded" — which was
    // only ever safe while the TMS knew. McLeod at this carrier does not (`orders.hazmat = 'Y'` on
    // 1 of 134,996 rows), hazmat is decided by our own rules engine, and `hazmat` sits in
    // `AMENDABLE_LOAD_FIELDS` where `tmsMayOverwrite` lets the feed write freely before approval.
    // A default of `false` therefore erased our determination on the next poll.
    const fields = {
      ref: input.ref,
      equipment: input.equipment,
      commodity: input.commodity,
      hazmat: input.hazmat,
      total_miles: input.total_miles,
      notes: input.notes,
      driver_id: resolve(input.driver_employee_id, resolvers.drivers),
      vehicle_id: resolve(input.vehicle_unit, resolvers.vehicles),
      trailer_id: resolve(input.trailer_unit, resolvers.trailers),
    };
    const withNulls = <T extends Record<string, unknown>>(o: T): Record<string, unknown> =>
      Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === undefined ? null : v]));

    const prior = existing.get(input.external_id);

    // ── cancellation upstream ────────────────────────────────────────────────
    if (input.canceled) {
      if (!prior) {
        return {
          kind: "skip",
          result: { external_id: input.external_id, ref: input.ref, outcome: "skipped", reason: "canceled upstream and never ingested" },
        };
      }
      if (prior.status === "canceled" || prior.status === "delivered") {
        return { kind: "skip", result: { external_id: input.external_id, ref: prior.ref, outcome: "unchanged" } };
      }
      // A driver may already be running this. The load is canceled either way — but it becomes a
      // loud dispatch exception rather than a row that quietly vanishes off a phone mid-run (D48).
      return {
        kind: "cancel",
        priorId: prior.id,
        from: prior.status,
        result: { external_id: input.external_id, ref: prior.ref, outcome: "canceled" },
      };
    }

    // ── new load ─────────────────────────────────────────────────────────────
    if (!prior) {
      return {
        kind: "create",
        input,
        row: {
          org_id: orgId,
          // `loads.hazmat` is NOT NULL DEFAULT false, so an absent value must be OMITTED and left to
          // the column default — never collapsed to null the way the nullable fields beside it are.
          // Without this, a feed that says nothing about hazmat (the normal case here, D-LM12) would
          // fail the insert on the NOT NULL constraint rather than create the load.
          ...omitUndefinedHazmat(withNulls(fields), fields.hazmat),
          source: "tms",
          provider,
          external_id: input.external_id,
          status,
          submitted_at: syncedAt,
          // Stamped on the insert rather than by a second UPDATE, which is one of the six round trips
          // per load that L11 removed. Same end state.
          external_status: input.external_status ?? null,
          // TMS attribution, never amendable (L4): who dispatches this load in McLeod. A new row has
          // nothing to preserve, so silence is written as null here like every other insert field.
          dispatcher_external_id: input.dispatcher_external_id ?? null,
          external_synced_at: syncedAt,
          ...(autoApprove ? { approved_at: syncedAt } : {}),
        },
        result: { external_id: input.external_id, ref: input.ref, outcome: "created" },
      };
    }

    // ── the feed still owns it: overwrite freely ─────────────────────────────
    if (tmsMayOverwrite(prior.status)) {
      // Drop the keys the feed said nothing about, so a partial sync patches rather than blanks.
      const patch = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
      return {
        kind: "own",
        priorId: prior.id,
        input,
        patch: {
          ...patch,
          ...(input.dispatcher_external_id !== undefined ? { dispatcher_external_id: input.dispatcher_external_id } : {}),
          external_status: input.external_status ?? null,
          external_synced_at: syncedAt,
        },
        result: { external_id: input.external_id, ref: input.ref, outcome: "updated" },
      };
    }

    // ── dispatch owns it: report, do not write (D48) ──────────────────────────
    const changed = AMENDABLE_LOAD_FIELDS.filter((f) => {
      const next = (fields as Record<string, unknown>)[f];
      const now = (prior as unknown as Record<string, unknown>)[f];
      return next !== undefined && next !== now;
    });

    if (changed.length === 0) {
      return {
        kind: "report",
        priorId: prior.id,
        input,
        event: null,
        result: { external_id: input.external_id, ref: prior.ref, outcome: "unchanged" },
      };
    }

    return {
      kind: "report",
      priorId: prior.id,
      input,
      event: {
        source: "tms",
        provider,
        changed,
        // Both sides of every changed field, so dispatch can decide without opening the TMS.
        diff: Object.fromEntries(
          changed.map((f) => [
            f,
            { from: (prior as unknown as Record<string, unknown>)[f], to: (fields as Record<string, unknown>)[f] },
          ]),
        ),
      },
      result: { external_id: input.external_id, ref: prior.ref, outcome: "amended", changed: [...changed] },
    };
  });
}

export async function ingestLoads(
  admin: SupabaseClient,
  orgId: string,
  provider: string,
  loads: TmsLoadInput[],
): Promise<LoadIngestResult> {
  const [vehicles, trailers, drivers, autoApprove, dispatchers] = await Promise.all([
    lookup(admin, "vehicles", orgId),
    lookup(admin, "trailers", orgId),
    driverLookup(admin, orgId),
    autoApproves(admin, orgId, provider),
    knownDispatcherIds(admin, orgId, provider),
  ]);

  // Everything this feed has already written for this org, so the whole batch is one lookup.
  const { data: existingRows } = await admin
    .from("loads")
    .select("id, status, ref, equipment, commodity, hazmat, driver_id, vehicle_id, trailer_id, external_id")
    .eq("org_id", orgId)
    .eq("provider", provider)
    .not("external_id", "is", null);
  const existing = new Map<string, ExistingLoad>();
  for (const r of (existingRows ?? []) as unknown as (ExistingLoad & { external_id: string })[]) {
    existing.set(r.external_id, r);
  }

  const unmatched = new Set<string>();
  const syncedAt = new Date().toISOString();
  const decisions = classify(
    loads,
    existing,
    { drivers, vehicles, trailers },
    autoApprove,
    orgId,
    provider,
    syncedAt,
    unmatched,
  );

  const status: LoadStatus = autoApprove ? "approved" : "pending_approval";
  const events: EventRow[] = [];
  const payloads: { loadId: string; raw: unknown }[] = [];
  const stops: { loadId: string; stops: TmsLoadInput["stops"] }[] = [];

  // ── loads the TMS withdrew ───────────────────────────────────────────────────
  const cancels = decisions.filter((d): d is Extract<Decision, { kind: "cancel" }> => d.kind === "cancel");
  await applyCancels(admin, orgId, cancels.map((c) => c.priorId));
  for (const c of cancels) {
    events.push({
      org_id: orgId, load_id: c.priorId, actor_role: "system", kind: "canceled",
      from_status: c.from, to_status: "canceled",
      payload: { source: "tms", provider, was: c.from },
    });
  }

  // ── new loads ────────────────────────────────────────────────────────────────
  //
  // Split by whether the feed spoke about `hazmat`, because PostgREST rejects a bulk insert whose
  // rows do not share a key set — and the two shapes mean different things (see omitUndefinedHazmat).
  // Two statements for any batch size, rather than one per load.
  const creates = decisions.filter((d): d is Extract<Decision, { kind: "create" }> => d.kind === "create");
  const byShape = new Map<string, Extract<Decision, { kind: "create" }>[]>();
  for (const c of creates) {
    const key = Object.keys(c.row).sort().join(",");
    const bucket = byShape.get(key);
    if (bucket) bucket.push(c);
    else byShape.set(key, [c]);
  }
  const idByExternal = await insertCreates(admin, [...byShape.values()].map((g) => g.map((c) => c.row)));
  for (const g of creates) {
    const id = idByExternal.get(g.input.external_id);
    if (!id) throw new Error(`[tms-loads] insert returned no id for ${g.input.external_id}`);
    payloads.push({ loadId: id, raw: g.input.raw });
    stops.push({ loadId: id, stops: g.input.stops });
    events.push({
      org_id: orgId, load_id: id, actor_role: "system", kind: "created",
      from_status: null, to_status: status,
      payload: { source: "tms", provider, external_id: g.input.external_id, stops: g.input.stops.length },
    });
    if (autoApprove) {
      events.push({
        org_id: orgId, load_id: id, actor_role: "system", kind: "approved",
        from_status: "pending_approval", to_status: "approved",
        payload: { source: "tms", auto: true },
      });
    }
  }

  // ── loads the feed still owns ────────────────────────────────────────────────
  const owned = decisions.filter((d): d is Extract<Decision, { kind: "own" }> => d.kind === "own");
  await applyOverwrites(admin, orgId, owned.map((o) => ({ loadId: o.priorId, patch: o.patch })));
  for (const o of owned) {
    payloads.push({ loadId: o.priorId, raw: o.input.raw });
    stops.push({ loadId: o.priorId, stops: o.input.stops });
  }

  // ── loads dispatch owns: stamp and report, never write the load itself ───────
  const reported = decisions.filter((d): d is Extract<Decision, { kind: "report" }> => d.kind === "report");
  await stampExternalStatus(
    admin,
    orgId,
    syncedAt,
    reported.map((r) => ({
      loadId: r.priorId,
      externalStatus: r.input.external_status ?? null,
      dispatcherExternalId: r.input.dispatcher_external_id,
    })),
  );
  for (const r of reported) {
    // Even an amendment dispatch has not applied is worth recording: it is the evidence behind the
    // banner they are about to read.
    payloads.push({ loadId: r.priorId, raw: r.input.raw });
    if (r.event) {
      events.push({
        org_id: orgId, load_id: r.priorId, actor_role: "system", kind: "amended",
        from_status: null, to_status: null, payload: r.event,
      });
    }
  }

  await writeStops(admin, orgId, stops);
  await writePayloads(admin, orgId, provider, syncedAt, payloads);
  await writeEvents(admin, events);

  return {
    received: loads.length,
    created: creates.length,
    amended: reported.filter((r) => r.event !== null).length,
    canceled: cancels.length,
    unmatched: [...unmatched],
    unknownDispatchers: [
      ...new Set(loads.map((l) => l.dispatcher_external_id).filter((d): d is string => !!d && !dispatchers.has(d))),
    ],
    // Reported in the order the feed sent them, whatever order the writes happened in.
    results: decisions.map((d) => d.result),
  };
}
