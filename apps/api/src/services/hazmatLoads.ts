import type { SupabaseClient } from "@supabase/supabase-js";
import {
  hazmatTransition, canEditLoad, isClearingEvent,
  type HazmatLoadStatus, type HazmatLoadEvent,
  type HazmatCreateLoadRequest, type HazmatUpdateLoadRequest, type HazmatListLoadsQuery,
  type HazmatRegisterDocumentRequest, type HazmatRegisterDocumentResponse,
} from "@fuelguard/shared";

/**
 * HazmatGuard load service (plan H4-3). Thin data layer over Supabase (service-role client; RLS is the
 * backstop for direct PostgREST, the route's requireRole is the API-layer gate). The load state machine
 * lives in `@fuelguard/shared` (hazmatLifecycle) so it is pure + tested; this module enforces it against
 * the DB. Corrections never edit runs/reviews — those are immutable (H4-2 migration).
 */

export const HAZMAT_LOAD_COLUMNS =
  "id, org_id, vehicle_id, trailer_id, driver_id, status, tank_state, carrier_relationship, " +
  "planned_pickup_at, declared_lines, bol_fields, special_permit_numbers, claimed_no_placards, " +
  "supersedes_load_id, version, created_by, created_at, updated_at";

export type ServiceError = { error: string; code: string };
const err = (code: string, error: string): ServiceError => ({ error, code });

export async function createLoad(
  admin: SupabaseClient, orgId: string, userId: string, req: HazmatCreateLoadRequest,
): Promise<{ id: string } | ServiceError> {
  const { error } = await admin.from("hazmat_loads").insert({
    id: req.id, org_id: orgId, created_by: userId,
    vehicle_id: req.vehicleId, trailer_id: req.trailerId, driver_id: req.driverId,
    tank_state: req.tankState, carrier_relationship: req.carrierRelationship,
    planned_pickup_at: req.plannedPickupAt, declared_lines: req.declaredLines,
    special_permit_numbers: req.specialPermitNumbers, claimed_no_placards: req.claimedNoPlacards,
    supersedes_load_id: req.supersedesLoadId,
  });
  if (error) return err("insert_failed", error.message);
  return { id: req.id };
}

export async function listLoads(
  admin: SupabaseClient, orgId: string, q: HazmatListLoadsQuery,
): Promise<{ rows: unknown[]; nextCursor: string | null }> {
  let query = admin.from("hazmat_loads").select(HAZMAT_LOAD_COLUMNS).eq("org_id", orgId);
  if (q.status) query = query.eq("status", q.status);
  if (q.cursor) query = query.lt("created_at", q.cursor); // keyset (01 §9): older than the last row seen
  query = query.order("created_at", { ascending: false }).limit(q.limit + 1);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as Array<{ created_at: string }>;
  const hasMore = rows.length > q.limit;
  const page = hasMore ? rows.slice(0, q.limit) : rows;
  const nextCursor = hasMore && page.length > 0 ? page[page.length - 1]!.created_at : null;
  return { rows: page, nextCursor };
}

export async function getLoad(admin: SupabaseClient, orgId: string, loadId: string): Promise<unknown | null> {
  const { data } = await admin
    .from("hazmat_loads").select(HAZMAT_LOAD_COLUMNS)
    .eq("org_id", orgId).eq("id", loadId).maybeSingle();
  return data ?? null;
}

function mapPatch(patch: HazmatUpdateLoadRequest): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (patch.vehicleId !== undefined) out.vehicle_id = patch.vehicleId;
  if (patch.trailerId !== undefined) out.trailer_id = patch.trailerId;
  if (patch.driverId !== undefined) out.driver_id = patch.driverId;
  if (patch.tankState !== undefined) out.tank_state = patch.tankState;
  if (patch.carrierRelationship !== undefined) out.carrier_relationship = patch.carrierRelationship;
  if (patch.plannedPickupAt !== undefined) out.planned_pickup_at = patch.plannedPickupAt;
  if (patch.declaredLines !== undefined) out.declared_lines = patch.declaredLines;
  if (patch.specialPermitNumbers !== undefined) out.special_permit_numbers = patch.specialPermitNumbers;
  if (patch.claimedNoPlacards !== undefined) out.claimed_no_placards = patch.claimedNoPlacards;
  return out;
}

export async function updateLoad(
  admin: SupabaseClient, orgId: string, loadId: string, patch: HazmatUpdateLoadRequest,
): Promise<{ ok: true } | ServiceError> {
  const { data } = await admin.from("hazmat_loads").select("status").eq("org_id", orgId).eq("id", loadId).maybeSingle();
  if (!data) return err("not_found", "Load not found.");
  if (!canEditLoad((data as { status: HazmatLoadStatus }).status)) {
    return err("not_editable", "Only a draft load may be edited; cleared loads are immutable — create a new load (link supersedes_load_id).");
  }
  const dbPatch = mapPatch(patch);
  if (Object.keys(dbPatch).length === 0) return { ok: true };
  const { error } = await admin.from("hazmat_loads").update(dbPatch).eq("org_id", orgId).eq("id", loadId);
  if (error) return err("update_failed", error.message);
  return { ok: true };
}

/** Apply a state-machine event to a load. Clearing events are refused on a provisional dataset (H1.6/D2). */
export async function transitionLoad(
  admin: SupabaseClient, orgId: string, loadId: string, event: HazmatLoadEvent,
  opts: { datasetProvisional?: boolean } = {},
): Promise<{ to: HazmatLoadStatus } | ServiceError> {
  const { data } = await admin.from("hazmat_loads").select("status").eq("org_id", orgId).eq("id", loadId).maybeSingle();
  if (!data) return err("not_found", "Load not found.");
  const from = (data as { status: HazmatLoadStatus }).status;
  const t = hazmatTransition(from, event);
  if (!t.ok) return err("illegal_transition", t.error ?? "Illegal transition.");
  if (isClearingEvent(event) && opts.datasetProvisional) {
    return err("provisional_dataset",
      "Clearing is refused: the active regulatory dataset is provisional (not second-source-verified). No load may be auto-cleared or attested against it (H1.6/D2).");
  }
  const { error } = await admin.from("hazmat_loads").update({ status: t.to }).eq("org_id", orgId).eq("id", loadId);
  if (error) return err("update_failed", error.message);
  return { to: t.to as HazmatLoadStatus };
}

export async function registerDocument(
  admin: SupabaseClient, orgId: string, userId: string, loadId: string, req: HazmatRegisterDocumentRequest,
): Promise<HazmatRegisterDocumentResponse | ServiceError> {
  const { data: load } = await admin.from("hazmat_loads").select("id").eq("org_id", orgId).eq("id", loadId).maybeSingle();
  if (!load) return err("not_found", "Load not found.");
  const ext = req.contentType === "image/jpeg" ? "orig.jpg" : "webp";
  const storagePath = `${orgId}/${loadId}/${req.id}.${ext}`;
  const { data: signed, error: signErr } = await admin.storage.from("hazmat").createSignedUploadUrl(storagePath);
  if (signErr || !signed) return err("sign_failed", signErr?.message ?? "Failed to sign upload URL.");
  const { error } = await admin.from("hazmat_documents").insert({
    id: req.id, org_id: orgId, load_id: loadId, kind: req.kind, page: req.page,
    storage_path: storagePath, sha256: req.sha256, uploaded_by: userId,
  });
  if (error) return err("insert_failed", error.message);
  return { documentId: req.id, storagePath, uploadUrl: signed.signedUrl, token: signed.token };
}

export async function getPolicy(admin: SupabaseClient, orgId: string): Promise<unknown | null> {
  const { data } = await admin
    .from("hazmat_policies").select("policy, updated_at, updated_by")
    .eq("org_id", orgId).maybeSingle();
  return data ?? null;
}

export async function putPolicy(
  admin: SupabaseClient, orgId: string, userId: string, policy: Record<string, unknown>,
): Promise<{ ok: true } | ServiceError> {
  const { error } = await admin.from("hazmat_policies").upsert({
    org_id: orgId, policy, updated_by: userId, updated_at: new Date().toISOString(),
  });
  if (error) return err("upsert_failed", error.message);
  return { ok: true };
}
