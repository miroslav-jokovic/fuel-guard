import { z } from "zod";

/**
 * Driver App — loads & assignments contract (Phase 3, migration 0085).
 *
 * The app PARSES every response with these schemas rather than casting (D24), so a drifted server
 * shape fails loudly at the boundary instead of poisoning a cache that lives on the device for days.
 * PostgREST returns `numeric` as a string, hence `z.coerce.number()` on the numeric columns.
 */

// ── enums (mirror the CHECK constraints in 0085) ──────────────────────────────
/**
 * Every state a load can hold, matching the `loads_status_check` constraint in 0087. The first three
 * are dispatch-only: a driver never receives them, because `loads_driver_scope` filters them out at
 * the database (D45). `DRIVER_VISIBLE_STATUSES` in `loadsLifecycle.ts` is that narrower set.
 */
export const LOAD_STATUSES = [
  "draft",
  "pending_approval",
  "approved",
  "offered",
  "accepted",
  "in_transit",
  "delivered",
  "canceled",
] as const;
export type LoadStatus = (typeof LOAD_STATUSES)[number];

export const STOP_KINDS = ["pickup", "dropoff"] as const;
export type StopKind = (typeof STOP_KINDS)[number];

export const STOP_STATUSES = ["pending", "arrived", "completed", "skipped"] as const;
export type StopStatus = (typeof STOP_STATUSES)[number];

/**
 * The photo slots a stop can require. Free-form `text[]` in the DB so dispatch can add one without a
 * migration; this list is what the app knows how to label and prompt for.
 */
export const PHOTO_SLOTS = ["trailer", "seal", "bol", "damage", "load_secured", "other"] as const;
export type PhotoSlot = (typeof PHOTO_SLOTS)[number];

export const PHOTO_SLOT_LABELS: Record<string, string> = {
  trailer: "Trailer",
  seal: "Seal",
  bol: "Bill of lading",
  damage: "Damage / condition",
  load_secured: "Load secured",
  other: "Other",
};

/** Human label for a slot, falling back to the raw value so an unknown slot still renders. */
export function photoSlotLabel(slot: string): string {
  return PHOTO_SLOT_LABELS[slot] ?? slot.replace(/_/g, " ");
}

// ── read shapes ───────────────────────────────────────────────────────────────
export const loadStopPhotoSchema = z.object({
  id: z.uuid(),
  slot: z.string(),
  storage_path: z.string(),
  captured_at: z.string().nullable(),
  uploaded_at: z.string(),
});
export type LoadStopPhoto = z.infer<typeof loadStopPhotoSchema>;

export const loadStopSchema = z.object({
  id: z.uuid(),
  seq: z.number().int(),
  kind: z.enum(STOP_KINDS),
  name: z.string(),
  address_line: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  postal_code: z.string().nullable(),
  lat: z.coerce.number().nullable(),
  lon: z.coerce.number().nullable(),
  appointment_start: z.string().nullable(),
  appointment_end: z.string().nullable(),
  status: z.enum(STOP_STATUSES),
  arrived_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  required_photos: z.array(z.string()).default([]),
  skip_reason: z.string().nullable(),
  notes: z.string().nullable(),
  photos: z.array(loadStopPhotoSchema).default([]),
});
export type LoadStop = z.infer<typeof loadStopSchema>;

export const loadSchema = z.object({
  id: z.uuid(),
  ref: z.string(),
  status: z.enum(LOAD_STATUSES),
  equipment: z.string().nullable(),
  commodity: z.string().nullable(),
  hazmat: z.boolean(),
  total_miles: z.coerce.number().nullable(),
  accepted_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  notes: z.string().nullable(),
  created_at: z.string(),
  /** Convenience join so the app can show the unit without a second query (D29). */
  vehicle_unit: z.string().nullable().default(null),
  trailer_unit: z.string().nullable().default(null),
  stops: z.array(loadStopSchema).default([]),
});
export type Load = z.infer<typeof loadSchema>;

/** `GET /api/me/loads` — one bootstrap payload, stops nested to avoid a launch waterfall. */
export const meLoadsResponseSchema = z.object({
  loads: z.array(loadSchema),
});
export type MeLoadsResponse = z.infer<typeof meLoadsResponseSchema>;

// ── write shapes ──────────────────────────────────────────────────────────────
/**
 * `POST /api/me/loads/:id/accept` — no body needed; the driver comes from the JWT and the load from
 * the path. `accepted_at` is client-supplied ONLY as a record of when the driver actually tapped
 * (they may have been offline for hours); the server still stamps its own authoritative time.
 */
export const acceptLoadRequestSchema = z.object({
  accepted_at: z.string().optional(),
});
export type AcceptLoadRequest = z.infer<typeof acceptLoadRequestSchema>;

/** One captured photo being reported after its file is already uploaded to Storage. */
export const stopPhotoInputSchema = z.object({
  /** Client UUID — the row PK, so a replayed sync collides and no-ops (idempotency). */
  id: z.uuid(),
  slot: z.string().min(1),
  storage_path: z.string().min(1),
  captured_at: z.string().optional(),
});
export type StopPhotoInput = z.infer<typeof stopPhotoInputSchema>;

/**
 * `POST /api/me/loads/:loadId/stops/:stopId` — advance a stop. Narrow by design: the server derives
 * org, driver, and timestamps; the client may only say what happened and attach its photos.
 */
export const completeStopRequestSchema = z.object({
  status: z.enum(["arrived", "completed", "skipped"]),
  /** Required when a stop is completed without one of its required photos, or skipped outright. */
  skip_reason: z.string().max(500).optional(),
  photos: z.array(stopPhotoInputSchema).max(12).default([]),
  /** When the driver actually did this (may predate the sync by hours). */
  occurred_at: z.string().optional(),
});
export type CompleteStopRequest = z.infer<typeof completeStopRequestSchema>;

// ── derivations shared by the app and the web dashboard ───────────────────────
/** The three buckets the driver app groups loads into. */
export function loadBucket(status: LoadStatus): "upcoming" | "current" | "previous" {
  // Only `in_transit` is Current — a load the driver has accepted but not started working is still
  // Upcoming. (This is the pairing that made `in_transit` unreachable before 0087 gave it a writer.)
  if (status === "in_transit") return "current";
  if (status === "delivered" || status === "canceled") return "previous";
  // Everything else — including the dispatch-only states a driver never receives — is ahead of them.
  return "upcoming";
}

/** The next stop a driver should work — the lowest-seq stop that isn't finished. */
export function nextStop(load: Pick<Load, "stops">): LoadStop | null {
  const open = load.stops
    .filter((s) => s.status !== "completed" && s.status !== "skipped")
    .sort((a, b) => a.seq - b.seq);
  return open[0] ?? null;
}

/** Progress along the run, for the Home hero's stop counter and bar. */
export function stopProgress(load: Pick<Load, "stops">): { current: number; total: number } {
  const total = load.stops.length;
  const done = load.stops.filter((s) => s.status === "completed" || s.status === "skipped").length;
  // "Stop 2 of 3" means the one being worked on, so clamp to the total once everything is finished.
  return { current: Math.min(done + 1, Math.max(total, 1)), total };
}

/** Which required slots still have no photo — drives the capture checklist. */
export function missingPhotoSlots(stop: Pick<LoadStop, "required_photos" | "photos">): string[] {
  const captured = new Set(stop.photos.map((p) => p.slot));
  return stop.required_photos.filter((slot) => !captured.has(slot));
}

/** Storage path for a stop photo: `${org}/${driver}/${load}/${photoId}.webp` (matches 0085 RLS). */
export function stopPhotoPath(
  orgId: string,
  driverId: string,
  loadId: string,
  photoId: string,
  ext = "webp",
): string {
  return `${orgId}/${driverId}/${loadId}/${photoId}.${ext}`;
}
