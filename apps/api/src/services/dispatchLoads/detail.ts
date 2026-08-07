import type { SupabaseClient } from "@supabase/supabase-js";
import { LOAD_COLUMNS, STOP_COLUMNS, one, type Join } from "./shared.js";
import { listEvents } from "./queries.js";

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
  const [stopsResult, photosByStop, events] = await Promise.all([
    admin
      .from("load_stops")
      .select(STOP_COLUMNS)
      .eq("org_id", orgId)
      .eq("load_id", loadId)
      .order("seq", { ascending: true }),
    stopPhotos(admin, orgId, loadId),
    listEvents(admin, orgId, loadId),
  ]);

  const { drivers, vehicles, trailers, ...load } = row as unknown as Record<string, unknown> & {
    drivers: Join;
    vehicles: Join;
    trailers: Join;
  };

  const stops = ((stopsResult.data ?? []) as unknown as { id: string }[]).map((s) => ({
    ...s,
    photos: photosByStop.get(s.id) ?? [],
  }));

  return {
    ...load,
    driver_name: one(drivers)?.full_name ?? null,
    vehicle_unit: one(vehicles)?.unit_number ?? null,
    trailer_unit: one(trailers)?.unit_number ?? null,
    stops,
    events,
  };
}
