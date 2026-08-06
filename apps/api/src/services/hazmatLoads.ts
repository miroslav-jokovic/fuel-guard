import type { SupabaseClient } from "@supabase/supabase-js";
import {
  hazmatTransition, canEditLoad, isClearingEvent, checkHazmatClear, buildHazmatAttestation,
  type OrgHazmatPolicy,
  type HazmatLoadStatus, type HazmatLoadEvent,
  type HazmatCreateLoadRequest, type HazmatUpdateLoadRequest, type HazmatListLoadsQuery,
  type HazmatRegisterDocumentRequest, type HazmatRegisterDocumentResponse,
  type HazmatReviewRequest,
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
  const { error } = await admin.from("hazmat_loads").upsert({
    id: req.id, org_id: orgId, created_by: userId,
    vehicle_id: req.vehicleId, trailer_id: req.trailerId, driver_id: req.driverId,
    tank_state: req.tankState, carrier_relationship: req.carrierRelationship,
    planned_pickup_at: req.plannedPickupAt, declared_lines: req.declaredLines,
    special_permit_numbers: req.specialPermitNumbers, claimed_no_placards: req.claimedNoPlacards,
    supersedes_load_id: req.supersedesLoadId,
  }, { onConflict: "id", ignoreDuplicates: true }); // idempotent replay (client-UUID PK) — offline outbox re-drains safely
  if (error) return err("insert_failed", error.message);
  return { id: req.id };
}

export async function listLoads(
  admin: SupabaseClient, orgId: string, q: HazmatListLoadsQuery,
): Promise<{ rows: unknown[]; nextCursor: string | null }> {
  const asc = q.order === "asc";
  let query = admin.from("hazmat_loads").select(HAZMAT_LOAD_COLUMNS).eq("org_id", orgId);
  if (q.status) query = query.eq("status", q.status);
  // keyset (01 §9): asc → newer than the last seen (oldest-first); desc → older than the last seen.
  if (q.cursor) query = asc ? query.gt("created_at", q.cursor) : query.lt("created_at", q.cursor);
  query = query.order("created_at", { ascending: asc }).limit(q.limit + 1);
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

// M4.1: extraction (per-field evidence incl. pass-A regions), advisories, and the M3 qualification
// record ride along — the review UI is decision support, and evidence hidden from the reviewer is
// evidence that does not exist.
export const HAZMAT_RUN_COLUMNS =
  "id, load_id, engine_version, dataset_version, verdict, outcome, flags, advisories, extraction, qualification, input_hash, created_at";

/** Runs for a load, newest first — the analysis history (immutable). Powers the H5 detail verdict view. */
export async function listRuns(
  admin: SupabaseClient, orgId: string, loadId: string,
): Promise<{ rows: unknown[] } | ServiceError> {
  const { data: load } = await admin.from("hazmat_loads").select("id").eq("org_id", orgId).eq("id", loadId).maybeSingle();
  if (!load) return err("not_found", "Load not found.");
  const { data, error } = await admin
    .from("hazmat_runs").select(HAZMAT_RUN_COLUMNS)
    .eq("org_id", orgId).eq("load_id", loadId)
    .order("created_at", { ascending: false });
  if (error) return err("query_failed", error.message);
  return { rows: (data ?? []) as unknown[] };
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

/** D19 (§14.1): hard cap on documents per load, enforced at registration — never at extraction,
 *  where the spend has already been queued. 10 pages × 2 models = 20 vision calls is the ceiling
 *  one load may cost. */
export const MAX_BOL_PAGES = 10;

export async function registerDocument(
  admin: SupabaseClient, orgId: string, userId: string, loadId: string, req: HazmatRegisterDocumentRequest,
): Promise<HazmatRegisterDocumentResponse | ServiceError> {
  const { data: load } = await admin.from("hazmat_loads").select("id").eq("org_id", orgId).eq("id", loadId).maybeSingle();
  if (!load) return err("not_found", "Load not found.");
  // D19: idempotent replay of an already-registered id must not count against the cap.
  const { count } = await admin.from("hazmat_documents")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId).eq("load_id", loadId).neq("id", req.id);
  if ((count ?? 0) >= MAX_BOL_PAGES) {
    return err("too_many_pages", `A load may carry at most ${MAX_BOL_PAGES} documents (D19 spend cap). Remove or supersede before adding more.`);
  }
  const ext = req.contentType === "image/jpeg" ? "orig.jpg" : "webp";
  const storagePath = `${orgId}/${loadId}/${req.id}.${ext}`;
  const { data: signed, error: signErr } = await admin.storage.from("hazmat").createSignedUploadUrl(storagePath);
  if (signErr || !signed) return err("sign_failed", signErr?.message ?? "Failed to sign upload URL.");
  const row: Record<string, unknown> = {
    id: req.id, org_id: orgId, load_id: loadId, kind: req.kind, page: req.page,
    storage_path: storagePath, sha256: req.sha256, uploaded_by: userId,
    content_type: req.contentType, // D1: recorded at registration; consumers no longer guess
  };
  if (req.capture) {
    // M6 driver capture: persist the on-device usability/scan provenance (DCE §7). `quality` reuses the
    // column 0092 already provisioned; the rest land in 0133's additive columns.
    row.quality = req.capture.quality;
    row.capture_config_version = req.capture.configVersion;
    row.capture_mode = req.capture.mode;
    row.os_enhanced = req.capture.osEnhanced;
    row.integrity_hash = req.capture.integrityHash;
    row.ocr_evidence = req.capture.ocrEvidence ?? null;
  }
  const { error } = await admin.from("hazmat_documents").upsert(row, { onConflict: "id", ignoreDuplicates: true });
  if (error) return err("insert_failed", error.message);
  return { documentId: req.id, storagePath, uploadUrl: signed.signedUrl, token: signed.token };
}

/** BOL/securement documents for a load, each with a short-lived signed DOWNLOAD url (review evidence, H7). */
export async function listDocuments(
  admin: SupabaseClient, orgId: string, loadId: string,
): Promise<{ rows: Array<{ id: string; kind: string; page: number; contentType: string | null; url: string | null }> } | ServiceError> {
  const { data: load } = await admin.from("hazmat_loads").select("id").eq("org_id", orgId).eq("id", loadId).maybeSingle();
  if (!load) return err("not_found", "Load not found.");
  const { data, error } = await admin
    .from("hazmat_documents").select("id, kind, page, content_type, storage_path")
    .eq("org_id", orgId).eq("load_id", loadId).order("page", { ascending: true });
  if (error) return err("query_failed", error.message);
  const docs = (data ?? []) as Array<{ id: string; kind: string; page: number; content_type: string | null; storage_path: string }>;
  // D20: ONE batch Storage call for the whole load, not one round trip per row.
  const byPath = new Map<string, string>();
  if (docs.length > 0) {
    const { data: signed } = await admin.storage.from("hazmat")
      .createSignedUrls(docs.map((d) => d.storage_path), 300); // 5-min TTL
    for (const s of signed ?? []) if (s.signedUrl && s.path) byPath.set(s.path, s.signedUrl);
  }
  const rows = docs.map((d) => ({
    id: d.id, kind: d.kind, page: d.page, contentType: d.content_type,
    url: byPath.get(d.storage_path) ?? null,
  }));
  return { rows };
}

export async function getPolicy(admin: SupabaseClient, orgId: string): Promise<unknown | null> {
  const { data } = await admin
    .from("hazmat_policies").select("policy, updated_at, updated_by")
    .eq("org_id", orgId).maybeSingle();
  return data ?? null;
}

export async function putPolicy(
  admin: SupabaseClient, orgId: string, userId: string, policy: OrgHazmatPolicy,
): Promise<{ ok: true } | ServiceError> {
  const { error } = await admin.from("hazmat_policies").upsert({
    org_id: orgId, policy, updated_by: userId, updated_at: new Date().toISOString(),
  });
  if (error) return err("upsert_failed", error.message);
  return { ok: true };
}


export async function recordReview(
  admin: SupabaseClient, orgId: string, userId: string, loadId: string, req: HazmatReviewRequest,
): Promise<{ ok: true; to?: HazmatLoadStatus } | ServiceError> {
  const { data: run } = await admin.from("hazmat_runs").select("id").eq("org_id", orgId).eq("load_id", loadId).eq("id", req.runId).maybeSingle();
  if (!run) return err("not_found", "Run not found for this load.");
  const { error } = await admin.from("hazmat_reviews").insert({
    org_id: orgId, load_id: loadId, run_id: req.runId, reviewer_id: userId,
    action: req.action, field_path: req.fieldPath ?? null, old_value: req.oldValue ?? null, new_value: req.newValue ?? null,
  });
  if (error) return err("insert_failed", error.message);
  if (req.action === "rejected") {
    const t = await transitionLoad(admin, orgId, loadId, "review_rejected");
    if ("error" in t) return t;
    return { ok: true, to: t.to };
  }
  return { ok: true };
}

/**
 * Clear a load after review — the ONLY auto/attested path to `cleared` from `needs_review`. Refused on a
 * provisional dataset (H1.6/D2, via transitionLoad). The attestation is recorded as an immutable review
 * row; the route additionally writes it to audit_logs, so the attestation survives even if this insert
 * races (a future SECURITY DEFINER RPC would make the transition+review atomic — noted for post-pilot).
 */
export interface ClearOptions {
  overrideReason: string | null;
  spAcknowledged: boolean;
  datasetProvisional: boolean;
}
/**
 * Clear a load — the ONLY attested path to `cleared`. The FULL fail-closed gate (D2/D8) is enforced HERE,
 * server-side, via the shared `checkHazmatClear`: a UI-only guard is not a guard. A violation run demands
 * an override reason (and records an `override` review row for the H12 report); a special-permit load
 * demands the SP acknowledgement; an unusable-read or provisional-dataset run cannot clear at all.
 */
export async function clearLoad(
  admin: SupabaseClient, orgId: string, userId: string, loadId: string, runId: string, opts: ClearOptions,
): Promise<{ to: HazmatLoadStatus } | ServiceError> {
  const { data: run } = await admin
    .from("hazmat_runs").select("id, flags").eq("org_id", orgId).eq("load_id", loadId).eq("id", runId).maybeSingle();
  if (!run) return err("not_found", "Run not found for this load.");
  const { data: load } = await admin
    .from("hazmat_loads").select("special_permit_numbers").eq("org_id", orgId).eq("id", loadId).maybeSingle();
  const flags = ((run as { flags?: string[] }).flags ?? []) as string[];
  const specialPermits = ((load as { special_permit_numbers?: string[] } | null)?.special_permit_numbers ?? []) as string[];

  const check = checkHazmatClear({ flags, datasetProvisional: opts.datasetProvisional, specialPermits, overrideReason: opts.overrideReason, spAcknowledged: opts.spAcknowledged });
  if (!check.ok) {
    // provisional/unusable → 409 (state); missing override/SP → 400 (bad request).
    const code = check.code === "provisional_dataset" ? "provisional_dataset" : check.code === "document_unusable" ? "not_clearable" : "attestation_incomplete";
    return err(code, check.message ?? "This load cannot be cleared.");
  }

  // A cleared violation is recorded as an explicit override review row (surfaced in the H12 report).
  if (check.requiresOverride) {
    await admin.from("hazmat_reviews").insert({
      org_id: orgId, load_id: loadId, run_id: runId, reviewer_id: userId, action: "override", new_value: (opts.overrideReason ?? "").trim(),
    });
  }

  const t = await transitionLoad(admin, orgId, loadId, "review_cleared", { datasetProvisional: opts.datasetProvisional });
  if ("error" in t) return t;
  // D4: the SERVER composes the attestation from what the gate actually verified — the client's
  // string is never stored. A client that could write its own attestation could write a weaker one.
  const attestation = buildHazmatAttestation(check, specialPermits, opts.overrideReason ?? "");
  const { error } = await admin.from("hazmat_reviews").insert({
    org_id: orgId, load_id: loadId, run_id: runId, reviewer_id: userId, action: "cleared", attestation,
  });
  if (error) return err("insert_failed", error.message);

  // M4.3 (D5): clearing a superseding load retires the load it replaces (cleared → superseded).
  // Best-effort by design: the new load IS cleared either way; a predecessor in any other state
  // simply isn't transitioned (the illegal-transition result is recorded, not thrown).
  const { data: withPred } = await admin.from("hazmat_loads")
    .select("supersedes_load_id").eq("org_id", orgId).eq("id", loadId).maybeSingle();
  const predecessorId = (withPred as { supersedes_load_id: string | null } | null)?.supersedes_load_id ?? null;
  if (predecessorId) {
    const sup = await transitionLoad(admin, orgId, predecessorId, "supersede");
    if ("error" in sup) console.warn(`[hazmat] predecessor ${predecessorId} not superseded: ${sup.error}`);
  }
  return { to: t.to };
}
