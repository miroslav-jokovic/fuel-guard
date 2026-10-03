import type { SupabaseClient } from "@supabase/supabase-js";
import {
  IDLE_ENGINE_DAY_COLUMNS,
  SAMSARA_ENGINE_DAY_COLUMNS,
  declaredEquipment,
  fetchAllPaged,
  idleBurnInputRows,
  idleBurnInputsArgs,
  idleEngineParityView,
  idleParityDays,
  idleParityFinalThrough,
  idleParityReport,
  learnIdleBurnRates,
  organizationTimezone,
  pickIdleCostBasis,
  type IdleBurnInputRpcRow,
  type IdleBurnRatesView,
  type IdleEngineDayRow,
  type IdleEngineParityView,
  type SamsaraEngineDayRow,
} from "@silvicom/shared";

/**
 * The idle engine's rollout checks for ONE customer (IE-ADMIN, FUEL-SAVINGS-AND-IDLE-ENGINE-PLAN.md §4
 * Q-FSV15 ruling 3, Q-FSV17): D-IE9's parity gate and D-IE5's learned burn rates. They are release
 * controls — whether the engine replaces today's idle figures, whether a learned rate replaces the
 * configured one — and nobody in a carrier's office can act on either, so they belong on the platform
 * plane rather than on the Idling page.
 *
 * ── THE SAME GATE AS THE OFFICE PANEL, NOT A SECOND ONE ──────────────────────────────────────────
 * This service may not import `apps/api` (`lint:boundaries`), so the queries are its own; everything
 * DECIDED about the rows is `@silvicom/shared`'s and is called, never restated: the columns
 * (`IDLE_ENGINE_DAY_COLUMNS`), the row-to-day pairing and Samsara's whole-day rule (`idleParityDays`),
 * which days are final (`idleParityFinalThrough`), the verdict (`idleParityReport`), the learner's
 * window and bands (`idleBurnInputsArgs`) and its fold (`learnIdleBurnRates`). The office reader
 * (`apps/api/src/modules/idle/idleEngineParity.ts`, `idleBurnRates.ts`) calls the same functions, so
 * the two views agree by construction — Q-FSV17 step (2) is the owner seeing that they do on the same
 * night before step (3) takes the office panels away.
 *
 * ── THE CONFIGURED RATE WITHOUT THE PRICE ────────────────────────────────────────────────────────
 * The office view prices nothing here either; it only reports `idle_gal_per_hour` through the cost
 * basis beside the learned table. `pickIdleCostBasis` takes the gallons from settings alone (the truck-
 * stop median only moves the PRICE), so it is called without one rather than copying the posted-prices
 * read into this service.
 *
 * ORG-FILTERED explicitly: the service role bypasses RLS, so every `.eq("org_id")` and `p_org` IS the
 * tenant boundary — the only org this reads is the one in the URL, and the route audits that it did.
 */

export interface OrgIdleEngine {
  parity: IdleEngineParityView;
  burnRates: IdleBurnRatesView;
}

/** The latest finished nightly's window start, or null when none has finished yet. */
async function latestNightlyFrom(admin: SupabaseClient, orgId: string): Promise<string | null> {
  const { data, error } = await admin
    .from("jobs")
    .select("stats")
    .eq("org_id", orgId)
    .eq("kind", "idle_engine")
    .eq("status", "done")
    .eq("stats->>mode", "nightly")
    .order("finished_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`idle engine: nightly read: ${error.message}`);
  const from = (data?.[0]?.stats as { from?: unknown } | undefined)?.from;
  return typeof from === "string" ? from : null;
}

async function readParity(
  admin: SupabaseClient,
  orgId: string,
  timezone: string,
  unitById: ReadonlyMap<string, string>,
): Promise<IdleEngineParityView> {
  const finalThrough = idleParityFinalThrough(await latestNightlyFrom(admin, orgId), timezone);
  const empty = idleEngineParityView(idleParityReport([], finalThrough), timezone, unitById);
  if (finalThrough == null) return empty;
  const ours = await fetchAllPaged<IdleEngineDayRow>((a, b) =>
    admin
      .from("idle_engine_days")
      .select(IDLE_ENGINE_DAY_COLUMNS)
      .eq("org_id", orgId)
      .lte("day", finalThrough)
      .order("day")
      .order("vehicle_id")
      .range(a, b),
  );
  if (ours.length === 0) return empty;
  const theirs = await fetchAllPaged<SamsaraEngineDayRow>((a, b) =>
    admin
      .from("vehicle_engine_days")
      .select(SAMSARA_ENGINE_DAY_COLUMNS)
      .eq("org_id", orgId)
      .gte("day", ours[0]!.day)
      .lte("day", finalThrough)
      .order("day")
      .order("vehicle_id")
      .range(a, b),
  );
  return idleEngineParityView(idleParityReport(idleParityDays(ours, theirs), finalThrough), timezone, unitById);
}

async function readConfiguredGalPerHour(admin: SupabaseClient, orgId: string): Promise<number> {
  const { data, error } = await admin.from("idle_settings").select("idle_gal_per_hour").eq("org_id", orgId).maybeSingle();
  if (error) throw new Error(`idle engine: settings read: ${error.message}`);
  const raw = (data as { idle_gal_per_hour?: number | string | null } | null)?.idle_gal_per_hour;
  // Numerics arrive from PostgREST as strings; `pickIdleCostBasis` owns what a non-positive one means.
  return pickIdleCostBasis({
    settingsGalPerHour: raw == null ? null : Number(raw),
    settingsPricePerGal: null,
    truckStopMedian: null,
  }).idleGalPerHour;
}

/** Null when the org does not exist (the route answers 404, and audits nothing it did not read). */
export async function readOrgIdleEngine(
  admin: SupabaseClient,
  orgId: string,
  now: Date = new Date(),
): Promise<OrgIdleEngine | null> {
  const { data: org, error } = await admin.from("organizations").select("id, operating_hours").eq("id", orgId).maybeSingle();
  if (error) throw new Error(`idle engine: org read: ${error.message}`);
  if (!org) return null;
  const timezone = organizationTimezone((org as { operating_hours?: object | null }).operating_hours);

  // Every truck, retired ones included: a park or a final day outlives its truck's service.
  const vehicles = await fetchAllPaged<{ id: string; unit_number: string; has_apu: boolean | null; apu_type: string | null }>(
    (a, b) => admin.from("vehicles").select("id, unit_number, has_apu, apu_type").eq("org_id", orgId).order("id").range(a, b),
  );
  const unitById = new Map(vehicles.map((v) => [v.id, v.unit_number]));
  const equipmentById = new Map(vehicles.map((v) => [v.id, declaredEquipment({ hasApu: v.has_apu, apuType: v.apu_type })]));

  const { from, to, args } = idleBurnInputsArgs(orgId, now);
  const [parity, burnRows, configuredGalPerHour] = await Promise.all([
    readParity(admin, orgId, timezone, unitById),
    fetchAllPaged<IdleBurnInputRpcRow>((a, b) => admin.rpc("idle_engine_burn_inputs", args).range(a, b)),
    readConfiguredGalPerHour(admin, orgId),
  ]);
  const rates = learnIdleBurnRates(
    idleBurnInputRows(burnRows),
    // A truck the vehicle read did not return is undeclared, not dropped: its hours still count.
    (id) => equipmentById.get(id) ?? "not_entered",
  );
  return { parity, burnRates: { ...rates, from, to, configuredGalPerHour } };
}
