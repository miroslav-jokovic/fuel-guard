/**
 * What an idling engine burns, learned from the fleet's own engines (IE4, D-IE5) — the reader of 0419,
 * which replaced 0409 as its measurement.
 *
 * The measurement is `idle_engine_burn_hours` (0419: per truck and ambient band, whole idle hours whose
 * neighbours hold no driving, and the engine counter's millilitres over them — 0409's per-park sums
 * carried the drive's edge fuel, Q-IE14 research 2026-10-03); the cohort is each truck's DECLARED
 * equipment (IE1, `declaredEquipment`), and the fold, the bands and the trucks-and-interval bar are
 * `learnIdleBurnRates`'. Nothing is stored: like the avoidable verdict, a learned rate is a function of
 * today's declarations over the stored hours, so a corrected declaration re-files a truck's history
 * the same day.
 *
 * ── LEARNED IS SHOWN, NOT YET USED ────────────────────────────────────────────────────────────────
 * D-IE5: prior and learned side by side until the owner accepts the switch. So every idle dollar on
 * the Idling page, the Dashboard and the fuel report is still priced at `idle_settings.idle_gal_per_hour`
 * (`resolveIdleCostBasis`), and this reader reports that rate beside the learned table. The engine's
 * own avoidable figure (`/engine/avoidable`) carries both prices; which one it shows is decided when
 * IE5 puts it on a page (§4 Q-IE14).
 *
 * ORG-FILTERED explicitly: the service role bypasses RLS, so the `p_org` argument and every
 * `.eq("org_id")` here IS the tenant boundary.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  declaredEquipment,
  IDLE_BURN_RPC,
  idleBurnInputRows,
  idleBurnInputsArgs,
  learnIdleBurnRates,
  type DeclaredEquipment,
  type IdleBurnInputRpcRow,
  type IdleBurnRates,
  type IdleBurnRatesView,
} from "@silvicom/shared";
import { fetchAllPaged } from "../../lib/paging.js";
import { resolveIdleCostBasis } from "./idleCostBasis.js";

interface VehicleEquipmentRow {
  id: string;
  has_apu: boolean | null;
  apu_type: string | null;
}

/** Every truck's declared equipment, retired ones included: a park outlives its truck's service. */
export async function readDeclaredEquipmentById(
  admin: SupabaseClient,
  orgId: string,
): Promise<Map<string, DeclaredEquipment>> {
  const vehicles = await fetchAllPaged<VehicleEquipmentRow>((a, b) =>
    admin.from("vehicles").select("id, has_apu, apu_type").eq("org_id", orgId).order("id").range(a, b),
  );
  return new Map(vehicles.map((v) => [v.id, declaredEquipment({ hasApu: v.has_apu, apuType: v.apu_type })]));
}

/** The learned table over the window ending `now`, each truck filed under `equipmentById`. */
export async function learnOrgIdleBurnRates(
  admin: SupabaseClient,
  orgId: string,
  equipmentById: ReadonlyMap<string, DeclaredEquipment>,
  now: Date = new Date(),
): Promise<IdleBurnRates & { from: string; to: string }> {
  const { from, to, args } = idleBurnInputsArgs(orgId, now);
  const rows = await fetchAllPaged<IdleBurnInputRpcRow>((a, b) => admin.rpc(IDLE_BURN_RPC, args).range(a, b));
  const rates = learnIdleBurnRates(
    idleBurnInputRows(rows),
    // A truck the vehicle read did not return is undeclared, not dropped: its hours still count.
    (id) => equipmentById.get(id) ?? "not_entered",
  );
  return { ...rates, from, to };
}

export async function readIdleBurnRates(
  admin: SupabaseClient,
  orgId: string,
  now: Date = new Date(),
): Promise<IdleBurnRatesView> {
  const [equipmentById, basis] = await Promise.all([
    readDeclaredEquipmentById(admin, orgId),
    resolveIdleCostBasis(admin, orgId),
  ]);
  const rates = await learnOrgIdleBurnRates(admin, orgId, equipmentById, now);
  return { ...rates, configuredGalPerHour: basis.idleGalPerHour };
}
