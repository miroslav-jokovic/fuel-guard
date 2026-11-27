import { z } from "zod";
import { recordId } from "./recordId.js";

/**
 * Driver App — loads & assignments contract (Phase 3, migration 0085).
 *
 * The app PARSES every response with these schemas rather than casting (D24), so a drifted server
 * shape fails loudly at the boundary instead of poisoning a cache that lives on the device for days.
 * PostgREST returns `numeric` as a string, hence `z.coerce.number()` on the numeric columns.
 */

// ── enums (mirror the CHECK constraints in 0085) ──────────────────────────────
/**
 * Every state a load can hold, matching the `loads_status_check` constraint in 0087. On a MANUAL load
 * the first three are dispatch-only: `loads_driver_scope` filters them out at the database (D45), and
 * `DRIVER_VISIBLE_STATUSES` in `loadsLifecycle.ts` is that narrower set. A McLeod load the office SENT
 * reaches its driver at pending_approval and approved too (0655, DF-1: "as soon as dispatch assigns
 * it"); only `draft` — uncovered in McLeod, nobody holds it — never does (`TMS_DRIVER_VISIBLE_STATUSES`).
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
/** The driver app's own "this stop is finished": worked, or skipped with a reason. */
export const DRIVER_DONE_STOP_STATUSES: readonly StopStatus[] = ["completed", "skipped"];

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

/**
 * The photos a driver is asked for at each kind of stop, on every load the office did not author
 * (McLeod's mirror and the old TMS feed). McLeod knows no carrier photo policy, so this is ours, stated
 * once (MCLEOD-API-KIT-PLAN Q-MK9, D-MKN5.1). It was written twice, identically, until 2026-11-27:
 * `loads/mirrorLoads.ts` and the retired `/api/tms/loads` writer `mcleod/tmsLoadIngestWriters.ts`.
 * `tms.ts`'s `tmsStopInputSchema` restates the stop kinds for that retired feed and goes with it (N-7).
 * No settings screen and no table: nobody has named a stop that needs another list, and
 * `load_stops.required_photos` stays free-form `text[]`, so a future per-stop rule needs no migration.
 */
export const REQUIRED_PHOTOS_BY_STOP_KIND: Readonly<Record<StopKind, readonly PhotoSlot[]>> = {
  pickup: ["trailer", "bol"],
  dropoff: ["bol"],
};

/** A fresh array: the value is written into a `text[]` column and must not alias the constant. */
export function requiredPhotosFor(kind: StopKind): PhotoSlot[] {
  return [...REQUIRED_PHOTOS_BY_STOP_KIND[kind]];
}

/**
 * The slots that hold a DOCUMENT rather than a photo of a thing. A document is scanned — the scanner
 * finds the page, straightens it and checks it can be read (owner, 2026-11-23: one scanner for every
 * document); a trailer, a seal or damage is photographed as it is.
 */
export const DOCUMENT_PHOTO_SLOTS: readonly string[] = ["bol"] satisfies readonly PhotoSlot[];

export function isDocumentSlot(slot: string): boolean {
  return DOCUMENT_PHOTO_SLOTS.includes(slot);
}

// ── read shapes ───────────────────────────────────────────────────────────────
export const loadStopPhotoSchema = z.object({
  id: recordId(),
  slot: z.string(),
  storage_path: z.string(),
  captured_at: z.string().nullable(),
  uploaded_at: z.string(),
});
export type LoadStopPhoto = z.infer<typeof loadStopPhotoSchema>;

export const loadStopSchema = z.object({
  id: recordId(),
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
  // ── McLeod's account of the stop (T1 N-9, columns since 0366 / 0660) ──
  // Every one is `.nullable().default(null)` (cD DR-4): an app must still parse an older or rolled-back
  // API that does not send them, and a manual load has none of them.
  /** McLeod's own `stop.status`, verbatim (`A` / `D`); null on a manual load. */
  external_status: z.string().nullable().default(null),
  /** McLeod's recorded arrival and departure — McLeod's facts, shown beside the driver's, never merged. */
  actual_arrival_at: z.string().nullable().default(null),
  actual_departure_at: z.string().nullable().default(null),
  /** When McLeod stopped listing the stop (0660, D-MK15). It stays on the load, behind the driver, labelled. */
  mcleod_removed_at: z.string().nullable().default(null),
});
export type LoadStop = z.infer<typeof loadStopSchema>;

export const loadSchema = z.object({
  id: recordId(),
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
  /**
   * Which system the load came from. A McLeod (`tms`) load is never offered or accepted: the office
   * sends it, the driver says "Got it", and its status stays McLeod's (D-LMR2). Defaulted so an app
   * reading an API from before T1 N-9 treats every load as the manual kind it was then.
   */
  source: z.enum(["manual", "tms"]).default("manual"),
  /**
   * When THIS driver said "Got it" to the load's CURRENT dispatch (0661 `driver_acknowledge_load`). Null
   * on a manual load, and again after the office re-sends the load: a new dispatch is a new question.
   */
  acknowledged_at: z.string().nullable().default(null),
  /** The customer the load is for — McLeod's, or the office's on a manual load. */
  customer_name: z.string().nullable().default(null),
});
export type Load = z.infer<typeof loadSchema>;

/** `GET /api/me/loads` — one bootstrap payload, stops nested to avoid a launch waterfall. */
export const meLoadsResponseSchema = z.object({
  loads: z.array(loadSchema),
});
export type MeLoadsResponse = z.infer<typeof meLoadsResponseSchema>;

// ── write shapes ──────────────────────────────────────────────────────────────
/**
 * The outbox record id of a driver action (D-MK23). 0661 writes the action's event WITH this id, so a
 * replay after a lost response finds its own event and does nothing. Optional until N-18 makes it
 * required; "Got it" requires it already (`acknowledgeLoadRequestSchema`).
 */
export const actionId = recordId().optional();

/**
 * `POST /api/me/loads/:id/accept` — no body needed; the driver comes from the JWT and the load from
 * the path. `accepted_at` is client-supplied ONLY as a record of when the driver actually tapped
 * (they may have been offline for hours); the server still stamps its own authoritative time.
 */
export const acceptLoadRequestSchema = z.object({
  accepted_at: z.string().optional(),
  action_id: actionId,
});
export type AcceptLoadRequest = z.infer<typeof acceptLoadRequestSchema>;

/** One captured photo being reported after its file is already uploaded to Storage. */
export const stopPhotoInputSchema = z.object({
  /** Client UUID — the row PK, so a replayed sync collides and no-ops (idempotency). */
  id: recordId(),
  slot: z.string().min(1),
  storage_path: z.string().min(1),
  captured_at: z.string().optional(),
  /** Hex SHA-256 of the uploaded bytes (0661 stores it), so the office can prove a file is the one taken. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
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
  action_id: actionId,
  /**
   * The Arrive this Complete carries (D-MK21): when the phone queued Arrive then Complete offline, the
   * Complete brings the arrival with it, so a McLeod stop's arrival is the driver's tap and not a
   * guess. `arrive_action_id` is that Arrive's own record id, so the Arrive arriving later replays.
   */
  arrived_at: z.string().optional(),
  arrive_action_id: recordId().optional(),
});
export type CompleteStopRequest = z.infer<typeof completeStopRequestSchema>;

/**
 * How long after a stop is completed a driver may still add a late photo to it (D-DV30). The SAME
 * number is `driver_add_stop_photos`'s DL007 guard in migration 0645; the app reads it from here to
 * decide whether to offer "Add", so the button never appears for a photo the server would refuse.
 */
export const LATE_PHOTO_WINDOW_DAYS = 14;

/**
 * `POST /api/me/loads/:loadId/stops/:stopId/photos` — a late photo for a stop the driver already
 * finished (migration 0645). Photos only: the finished stop's status, times and reason stay as they are.
 */
export const addStopPhotosRequestSchema = z.object({
  photos: z.array(stopPhotoInputSchema).min(1).max(12),
  occurred_at: z.string().optional(),
  // Accepted for one outbox shape across every load action; the late-photo function's replay key is
  // each photo's own id (0645, kept by 0661), so the API does not pass this on.
  action_id: actionId,
});
export type AddStopPhotosRequest = z.infer<typeof addStopPhotosRequestSchema>;

/**
 * `POST /api/me/loads/:id/acknowledge` — "Got it" on a McLeod load the office sent (DF-2). The action
 * id is REQUIRED here from the first build (0661 raises DL015 without it): "Got it" has no state to
 * be idempotent on, so the outbox record id is the only thing that makes a replay a no-op.
 */
export const acknowledgeLoadRequestSchema = z.object({
  action_id: recordId(),
  occurred_at: z.string().optional(),
});
export type AcknowledgeLoadRequest = z.infer<typeof acknowledgeLoadRequestSchema>;

/**
 * What a load action did, as the database function answered it (0661). `late_evidence` is a 200, never
 * a 4xx (D-MK20): the phone's photos were KEPT, against a load the office has since re-sent or a stop
 * McLeod removed, and the outbox must mark the record done rather than park it in Needs attention.
 */
export const LOAD_ACTION_STATUSES = ["recorded", "replayed", "photos_added", "already_done", "late_evidence"] as const;
export type LoadActionStatus = (typeof LOAD_ACTION_STATUSES)[number];

/** The 200 answer of every `POST /api/me/loads/:id/...` action: the fresh load (null once it left you) and what happened. */
export const loadActionResponseSchema = z.object({
  load: loadSchema.nullable(),
  // Defaulted: an API from before T1 N-9 answered `{ load }` alone, and then every 200 was a recording.
  status: z.enum(LOAD_ACTION_STATUSES).default("recorded"),
});
export type LoadActionResponse = z.infer<typeof loadActionResponseSchema>;

/**
 * True while a COMPLETED stop still takes a late photo: completed, and within the window. A skipped
 * stop never does (it was never visited), and a pending or arrived one goes through completion instead.
 */
export function latePhotoOpen(
  stop: Pick<LoadStop, "status" | "completed_at">,
  now: number = Date.now(),
): boolean {
  if (stop.status !== "completed" || !stop.completed_at) return false;
  const done = Date.parse(stop.completed_at);
  return Number.isFinite(done) && now - done < LATE_PHOTO_WINDOW_DAYS * 86_400_000;
}

// ── derivations shared by the app and the web dashboard ───────────────────────
// `loadBucket`, `nextStop` and `stopProgress` live in `driverLoadPhase.ts` (T1 N-9): they read the
// office's `isStopBehindTruck` (loadBoard.ts), which imports this file, so here they made a cycle.

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

/**
 * `GET /api/dispatch/loads?delivered_from=&delivered_before=` (LOADS-ACTIVITY-PLAN D-LA6): a window of
 * DELIVERY time, as instants, `before` exclusive. The page turns its picked carrier days into these
 * (`dayRangeInstants`), so the server never guesses a zone. Both or neither: half a window is refused
 * rather than read as "everything since", which is the unbounded read the window exists to stop.
 */
export const deliveredWindowQuerySchema = z
  .object({
    delivered_from: z.string().datetime({ offset: true }).optional(),
    delivered_before: z.string().datetime({ offset: true }).optional(),
  })
  .refine((q) => (q.delivered_from === undefined) === (q.delivered_before === undefined), {
    message: "delivered_from and delivered_before go together",
  })
  .refine((q) => !q.delivered_from || !q.delivered_before || Date.parse(q.delivered_from) < Date.parse(q.delivered_before), {
    message: "delivered_from must be before delivered_before",
  });
export type DeliveredWindowQuery = z.infer<typeof deliveredWindowQuerySchema>;
