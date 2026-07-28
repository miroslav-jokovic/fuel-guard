import { stopPhotoPath, type LoadStop } from '@fuelguard/shared';

/**
 * Stop-capture view logic (Phase 3C). Pure and unit-tested — the screen holds captured photos in
 * local state until the driver completes the stop, and these helpers decide what is still outstanding,
 * whether a reason is required (D21), and how to shape the outbox photo payload.
 */

/** A photo captured this session: taken, re-encoded, staged — but not yet enqueued or uploaded. */
export interface SessionCapture {
  /** Client UUID → the load_stop_photos row PK, so a replayed sync collides and no-ops (idempotency). */
  photoId: string;
  slot: string;
  /** The processed (resized, EXIF-stripped) JPEG in the app sandbox. */
  localUri: string;
  capturedAt: string;
}

/** Slots already satisfied — a photo synced on a previous pass OR captured in this session. */
export function satisfiedSlots(
  stop: Pick<LoadStop, 'photos'>,
  captures: readonly SessionCapture[],
): Set<string> {
  const set = new Set<string>();
  for (const p of stop.photos) set.add(p.slot);
  for (const c of captures) set.add(c.slot);
  return set;
}

/** Required slots that still have no photo — drives the checklist and the reason gate. */
export function outstandingSlots(
  stop: Pick<LoadStop, 'required_photos' | 'photos'>,
  captures: readonly SessionCapture[],
): string[] {
  const have = satisfiedSlots(stop, captures);
  return stop.required_photos.filter((slot) => !have.has(slot));
}

/**
 * Completing a stop with an outstanding required photo is allowed (never a dead end — D21) but the
 * driver must say why. Skipping a stop always needs a reason regardless.
 */
export function reasonRequiredToComplete(
  stop: Pick<LoadStop, 'required_photos' | 'photos'>,
  captures: readonly SessionCapture[],
): boolean {
  return outstandingSlots(stop, captures).length > 0;
}

/** One photo as the outbox carries it: the API fields plus the local file the handler uploads. */
export interface StagedStopPhoto {
  id: string;
  slot: string;
  storage_path: string;
  captured_at: string;
  /** Filled with the STAGED uri by the hook; the handler uploads this, then drops it from the POST. */
  local_uri: string;
}

/**
 * Turn this session's captures into the outbox photo payload. `storage_path` is computed client-side
 * because the storage RLS keys on `${org}/${driver}/…` — the app must upload to exactly the path it
 * reports, and both must match the driver in the JWT (migration 0085).
 */
export function buildStopPhotos(args: {
  orgId: string;
  driverId: string;
  loadId: string;
  captures: readonly SessionCapture[];
}): StagedStopPhoto[] {
  return args.captures.map((c) => ({
    id: c.photoId,
    slot: c.slot,
    storage_path: stopPhotoPath(args.orgId, args.driverId, args.loadId, c.photoId, 'jpg'),
    captured_at: c.capturedAt,
    local_uri: c.localUri,
  }));
}
