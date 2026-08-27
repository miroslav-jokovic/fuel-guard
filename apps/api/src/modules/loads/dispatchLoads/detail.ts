import type { SupabaseClient } from "@supabase/supabase-js";
import { LOAD_COLUMNS, STOP_COLUMNS, one, type Join } from "./shared.js";
import { listEvents } from "./queries.js";
import { externalPayload, stopEquipment } from "./duty.js";

/**
 * The point-read behind `GET /api/dispatch/loads/:id` (ship-pipeline LD1 / D-LD2).
 *
 * WHY THIS EXISTS. Until now the dashboard's "detail" was a `.find()` over `GET /loads`, which
 * returns every load in the organization with every stop nested and no pagination. That is why
 * `/loads/:id` could only ever be a drawer over a list that was already in memory: deep-linking to a
 * load meant loading the whole board first, and the panel went stale whenever the list query did.
 *
 * It also returns the three things dispatch has never been able to see, all of which were already
 * captured and already stored:
 *
 *   · the PHOTOS a driver took at each stop (D-L1) — rows in `load_stop_photos`, bytes in the
 *     `load-photos` bucket, dispatch holding SELECT on both, and nothing anywhere reading either;
 *   · each stop's REAL state — status, arrival, completion, and the driver's free-text explaining a
 *     missing bill of lading, which reached the database and never reached the office (D21);
 *   · the lifecycle PROVENANCE — submitted / approved / released / assigned / accepted / completed,
 *     each with its actor. `LOAD_COLUMNS` has always returned these; the web type simply omitted them.
 *
 * Photos are signed server-side in ONE batch call with a 5-minute TTL, the same shape
 * `hazmatLoads.ts:189` uses. A per-photo round trip would make a twelve-stop load unusable, and
 * long-lived URLs would put proof-of-work images one leaked link away from being public.
 */

/** How long a signed photo URL lives. Long enough to open a lightbox, short enough to be useless if copied. */
const PHOTO_URL_TTL_SECONDS = 300;

const PHOTO_COLUMNS = "id, stop_id, slot, storage_path, captured_at, uploaded_at";

export interface LoadPhoto {
  id: string;
  stop_id: string;
  slot: string;
  captured_at: string | null;
  uploaded_at: string;
  /** Null when signing failed — the UI shows "couldn't load", never a broken image. */
  url: string | null;
}

async function stopPhotos(
  admin: SupabaseClient,
  orgId: string,
  loadId: string,
): Promise<Map<string, LoadPhoto[]>> {
  const byStop = new Map<string, LoadPhoto[]>();
  const { data, error } = await admin
    .from("load_stop_photos")
    .select(PHOTO_COLUMNS)
    .eq("org_id", orgId)
    .eq("load_id", loadId)
    .order("uploaded_at", { ascending: true });
  // A signing or read failure must not take the whole load detail down with it: the stops, the
  // timeline and the checklist are all still worth showing.
  if (error) return byStop;

  const rows = (data ?? []) as unknown as {
    id: string;
    stop_id: string;
    slot: string;
    storage_path: string;
    captured_at: string | null;
    uploaded_at: string;
  }[];
  if (rows.length === 0) return byStop;

  const signed = new Map<string, string>();
  try {
    const { data: urls } = await admin.storage
      .from("load-photos")
      .createSignedUrls(rows.map((r) => r.storage_path), PHOTO_URL_TTL_SECONDS);
    for (const u of urls ?? []) if (u.path && u.signedUrl) signed.set(u.path, u.signedUrl);
  } catch {
    /* leave every url null — see LoadPhoto.url */
  }

  for (const r of rows) {
    const list = byStop.get(r.stop_id) ?? [];
    list.push({
      id: r.id,
      stop_id: r.stop_id,
      slot: r.slot,
      captured_at: r.captured_at,
      uploaded_at: r.uploaded_at,
      url: signed.get(r.storage_path) ?? null,
    });
    byStop.set(r.stop_id, list);
  }
  return byStop;
}

const HAZMAT_RECORD_COLUMNS = "id, status, tank_state, created_at, updated_at";

/** The hazmat record this load carries, if any — enough for the detail page to show the state and
 *  open the workspace, and no more. The full verdict stays behind `/api/hazmat/loads/:id`. */
export interface LinkedHazmatRecord {
  id: string;
  status: string;
  tank_state: string;
  created_at: string;
  updated_at: string;
  /** Newest analysis outcome, or null when the record has never been analysed. */
  latest_outcome: string | null;
  latest_run_at: string | null;
}

/**
 * Read the linked hazmat record (H-C1, migration 0148).
 *
 * At most one row can match: `idx_hazmat_loads_dispatch_load` is a partial unique index on `load_id`,
 * which is the whole point of the link. A failure here returns null rather than throwing — an org
 * without the HazmatGuard entitlement has no records to find, and a hazmat read has no business
 * taking the stops, the photos and the timeline down with it.
 */
async function linkedHazmat(
  admin: SupabaseClient,
  orgId: string,
  loadId: string,
): Promise<LinkedHazmatRecord | null> {
  const { data, error } = await admin
    .from("hazmat_loads")
    .select(HAZMAT_RECORD_COLUMNS)
    .eq("org_id", orgId)
    .eq("load_id", loadId)
    .maybeSingle();
  if (error || !data) return null;
  const record = data as unknown as Omit<LinkedHazmatRecord, "latest_outcome" | "latest_run_at">;

  const { data: run } = await admin
    .from("hazmat_runs")
    .select("outcome, created_at")
    .eq("org_id", orgId)
    .eq("load_id", record.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const latest = (run ?? null) as { outcome: string; created_at: string } | null;

  return { ...record, latest_outcome: latest?.outcome ?? null, latest_run_at: latest?.created_at ?? null };
}

/** One load with everything the detail page needs, or null when it is not this org's. */
export async function getLoadDetail(
  admin: SupabaseClient,
  orgId: string,
  loadId: string,
): Promise<Record<string, unknown> | null> {
  const { data: row, error } = await admin
    .from("loads")
    .select(LOAD_COLUMNS)
    .eq("org_id", orgId)
    .eq("id", loadId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) return null;

  // Stops, photos and the timeline are independent of one another — fetch them together rather than
  // in a waterfall. The load read above has to come first: it is what proves the org owns this id.
  const [stopsResult, photosByStop, events, hazmatRecord, provenance] = await Promise.all([
    admin
      .from("load_stops")
      .select(STOP_COLUMNS)
      .eq("org_id", orgId)
      .eq("load_id", loadId)
      .order("seq", { ascending: true }),
    stopPhotos(admin, orgId, loadId),
    listEvents(admin, orgId, loadId),
    linkedHazmat(admin, orgId, loadId),
    externalPayload(admin, orgId, loadId),
  ]);

  const { drivers, vehicles, trailers, ...load } = row as unknown as Record<string, unknown> & {
    drivers: Join;
    vehicles: Join;
    trailers: Join;
  };

  const rawStops = (stopsResult.data ?? []) as unknown as {
    id: string;
    arrived_at?: string | null;
    completed_at?: string | null;
  }[];

  // LD5: which truck and trailer the driver was ACTUALLY in when they worked each stop. Depends on
  // the stops, so it cannot join the fan-out above.
  const equipment = await stopEquipment(admin, orgId, load.driver_id as string | null, rawStops, {
    vehicle_id: (load.vehicle_id as string | null) ?? null,
    trailer_id: (load.trailer_id as string | null) ?? null,
  });

  const stops = rawStops.map((s) => ({
    ...s,
    photos: photosByStop.get(s.id) ?? [],
    // Null until the stop has been worked — dispatch's plan is already on the load itself.
    actual_equipment: equipment.get(s.id) ?? null,
  }));

  return {
    ...load,
    driver_name: one(drivers)?.full_name ?? null,
    vehicle_unit: one(vehicles)?.unit_number ?? null,
    trailer_unit: one(trailers)?.unit_number ?? null,
    stops,
    events,
    // H-C1: the hazmat workspace opens from here, so hazmat stops needing a navigation section of
    // its own. Null for the overwhelming majority of loads, which is the correct shape.
    hazmat_record: hazmatRecord,
    // LD5: what the source TMS last said. Null for a manually created load, which is most of them.
    // The payload is office-only at the database (0150) as well as here.
    external: provenance,
  };
}
