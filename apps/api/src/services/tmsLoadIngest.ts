import type { SupabaseClient } from "@supabase/supabase-js";
import {
  unitResolver,
  driverResolver,
  type KeyResolver,
  type UnitRow,
  type DriverKeyRow,
} from "../tms/entityLookup.js";
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
 */

export interface LoadIngestResult {
  received: number;
  created: number;
  amended: number;
  canceled: number;
  /** Match keys (unit numbers / employee ids) we could not resolve — reported, never silently dropped. */
  unmatched: string[];
  results: TmsLoadResult[];
}

/**
 * Record what the TMS said (LD5). `external_status` goes on the load — it is a status word, safe for
 * a driver to see, and the field the cancellation path reads; the payload goes in
 * `load_external_payloads`, which drivers cannot read at all, because a McLeod order carries rates.
 *
 * Best-effort on purpose: provenance is evidence about an ingest, and losing it must never fail the
 * ingest itself. A load that arrived is worth more than the record of how it arrived.
 */
async function writeProvenance(
  admin: SupabaseClient,
  orgId: string,
  loadId: string,
  provider: string,
  input: TmsLoadInput,
): Promise<void> {
  const syncedAt = new Date().toISOString();
  const { error: loadErr } = await admin
    .from("loads")
    .update({ external_status: input.external_status ?? null, external_synced_at: syncedAt })
    .eq("id", loadId)
    .eq("org_id", orgId);
  if (loadErr) console.error(`[tms-loads] external_status not recorded for ${loadId}: ${loadErr.message}`);

  if (!input.raw) return;
  const { error } = await admin.from("load_external_payloads").upsert(
    { load_id: loadId, org_id: orgId, provider, raw: input.raw, synced_at: syncedAt },
    { onConflict: "load_id" },
  );
  if (error) console.error(`[tms-loads] payload not recorded for ${loadId}: ${error.message}`);
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

/** Write the append-only timeline entry. Best-effort — never fails an ingest batch. */
async function event(
  admin: SupabaseClient,
  orgId: string,
  loadId: string,
  kind: string,
  payload: Record<string, unknown>,
  fromStatus?: string,
  toStatus?: string,
): Promise<void> {
  const { error } = await admin.from("load_events").insert({
    org_id: orgId,
    load_id: loadId,
    actor_role: "system",
    kind,
    from_status: fromStatus ?? null,
    to_status: toStatus ?? null,
    payload,
  });
  if (error) console.error(`[tms] load event '${kind}' failed: ${error.message}`);
}

/** Replace the stops of a load the feed still owns. Never touches a stop a driver has worked. */
async function writeStops(
  admin: SupabaseClient,
  orgId: string,
  loadId: string,
  stops: TmsLoadInput["stops"],
): Promise<void> {
  await admin.from("load_stops").delete().eq("load_id", loadId).eq("status", "pending");
  if (stops.length === 0) return;
  const { error } = await admin.from("load_stops").upsert(
    stops.map((s) => ({
      org_id: orgId,
      load_id: loadId,
      seq: s.seq,
      kind: s.kind,
      name: s.name,
      address_line: s.address_line ?? null,
      city: s.city ?? null,
      state: s.state ?? null,
      postal_code: s.postal_code ?? null,
      lat: s.lat ?? null,
      lon: s.lon ?? null,
      appointment_start: s.appointment_start ?? null,
      appointment_end: s.appointment_end ?? null,
      // The feed does not know a carrier's photo policy — dispatch sets those slots. Defaults keep a
      // driver from arriving at a shipper with nothing to capture.
      required_photos: s.kind === "pickup" ? ["trailer", "bol"] : ["bol"],
      notes: s.notes ?? null,
    })),
    { onConflict: "load_id,seq" },
  );
  if (error) throw new Error(error.message);
}

export async function ingestLoads(
  admin: SupabaseClient,
  orgId: string,
  provider: string,
  loads: TmsLoadInput[],
): Promise<LoadIngestResult> {
  const [vehicles, trailers, drivers, autoApprove] = await Promise.all([
    lookup(admin, "vehicles", orgId),
    lookup(admin, "trailers", orgId),
    driverLookup(admin, orgId),
    autoApproves(admin, orgId, provider),
  ]);

  const unmatched = new Set<string>();
  const results: TmsLoadResult[] = [];
  let created = 0;
  let amended = 0;
  let canceled = 0;

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

  for (const input of loads) {
    /**
     * `undefined` means the feed said NOTHING about this field — not that it was cleared. The
     * distinction matters: a sync that omits driver info would otherwise read as "dispatch's driver
     * was removed" and raise a false amendment on every poll. `null` is an explicit clear.
     */
    const resolve = (
      key: string | null | undefined,
      by: KeyResolver,
    ): string | null | undefined => {
      if (key === undefined) return undefined;
      if (key === null) return null;
      const hit = by.get(key);
      if (!hit) unmatched.add(key);
      return hit ?? null;
    };
    const driver_id = resolve(input.driver_employee_id, drivers);
    const vehicle_id = resolve(input.vehicle_unit, vehicles);
    const trailer_id = resolve(input.trailer_unit, trailers);

    // `undefined` is preserved throughout: it means the feed said nothing about this field, which is
    // different from clearing it. Only the insert path collapses undefined to null (a new row has
    // nothing to preserve). `hazmat` always has a value because the schema defaults it — a feed
    // asserting "not placarded" is real information.
    const fields = {
      ref: input.ref,
      equipment: input.equipment,
      commodity: input.commodity,
      hazmat: input.hazmat,
      total_miles: input.total_miles,
      notes: input.notes,
      driver_id,
      vehicle_id,
      trailer_id,
    };
    const withNulls = <T extends Record<string, unknown>>(o: T): Record<string, unknown> =>
      Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === undefined ? null : v]));

    const prior = existing.get(input.external_id);

    // ── cancellation upstream ────────────────────────────────────────────────
    if (input.canceled) {
      if (!prior) {
        results.push({ external_id: input.external_id, ref: input.ref, outcome: "skipped", reason: "canceled upstream and never ingested" });
        continue;
      }
      if (prior.status === "canceled" || prior.status === "delivered") {
        results.push({ external_id: input.external_id, ref: prior.ref, outcome: "unchanged" });
        continue;
      }
      // A driver may already be running this. The load is canceled either way — but it becomes a
      // loud dispatch exception rather than a row that quietly vanishes off a phone mid-run (D48).
      await admin
        .from("loads")
        .update({ status: "canceled", cancel_reason: "Canceled in the TMS" })
        .eq("id", prior.id);
      await event(admin, orgId, prior.id, "canceled", { source: "tms", provider, was: prior.status }, prior.status, "canceled");
      canceled += 1;
      results.push({ external_id: input.external_id, ref: prior.ref, outcome: "canceled" });
      continue;
    }

    // ── new load ─────────────────────────────────────────────────────────────
    if (!prior) {
      const status: LoadStatus = autoApprove ? "approved" : "pending_approval";
      const { data, error } = await admin
        .from("loads")
        .insert({
          org_id: orgId,
          ...withNulls(fields),
          source: "tms",
          provider,
          external_id: input.external_id,
          status,
          submitted_at: new Date().toISOString(),
          ...(autoApprove ? { approved_at: new Date().toISOString() } : {}),
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);

      const id = (data as { id: string }).id;
      await writeProvenance(admin, orgId, id, provider, input);
      await writeStops(admin, orgId, id, input.stops);
      await event(admin, orgId, id, "created", { source: "tms", provider, external_id: input.external_id, stops: input.stops.length }, undefined, status);
      if (autoApprove) {
        await event(admin, orgId, id, "approved", { source: "tms", auto: true }, "pending_approval", "approved");
      }
      created += 1;
      results.push({ external_id: input.external_id, ref: input.ref, outcome: "created" });
      continue;
    }

    // ── the feed still owns it: overwrite freely ─────────────────────────────
    if (tmsMayOverwrite(prior.status)) {
      // Drop the keys the feed said nothing about, so a partial sync patches rather than blanks.
      const patch = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
      const { error } = await admin.from("loads").update(patch).eq("id", prior.id);
      if (error) throw new Error(error.message);
      await writeProvenance(admin, orgId, prior.id, provider, input);
      await writeStops(admin, orgId, prior.id, input.stops);
      results.push({ external_id: input.external_id, ref: input.ref, outcome: "updated" });
      continue;
    }

    // ── dispatch owns it: report, do not write (D48) ──────────────────────────
    const changed = AMENDABLE_LOAD_FIELDS.filter((f) => {
      const next = (fields as Record<string, unknown>)[f];
      const now = (prior as unknown as Record<string, unknown>)[f];
      return next !== undefined && next !== now;
    });

    // Even an amendment dispatch has not applied is worth recording: it is the evidence behind the
    // banner they are about to read.
    await writeProvenance(admin, orgId, prior.id, provider, input);

    if (changed.length === 0) {
      results.push({ external_id: input.external_id, ref: prior.ref, outcome: "unchanged" });
      continue;
    }

    await event(
      admin,
      orgId,
      prior.id,
      "amended",
      {
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
    );
    amended += 1;
    results.push({ external_id: input.external_id, ref: prior.ref, outcome: "amended", changed: [...changed] });
  }

  return { received: loads.length, created, amended, canceled, unmatched: [...unmatched], results };
}
