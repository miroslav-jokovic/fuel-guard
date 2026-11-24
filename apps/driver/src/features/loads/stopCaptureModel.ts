import { isDocumentSlot, stopPhotoPath, type LoadStop } from '@silvicom/shared';

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

/** What the Stop screen's pinned footer offers (Visual 2026 D-DV27, Q-DV8 a). */
export interface StopFooter {
  /** The ONE amber action (D-DV5). `take` opens the capture for `slot`. */
  primary:
    | { kind: 'arrive'; label: string }
    | { kind: 'take'; label: string; slot: string }
    | { kind: 'complete'; label: string };
  /** Quiet text buttons under it, in order. `complete` goes through D21's reason sheet when a photo is missing. */
  quiet: { kind: 'complete' | 'skip'; label: string }[];
}

function slotNoun(slot: string): string {
  return slot === 'bol' ? 'BOL' : slot.replace(/_/g, ' ');
}

/**
 * The footer does one thing at a time. The V9 critiques (2026-11-22) found three ambers on one
 * Stop screen while a photo was missing — the row's glyph, the row's "Take", and a primary that read
 * "Complete · 1 photo missing", which named its own blocker and wrapped to two lines. Now:
 * - pending: "Mark arrived"; Complete stays reachable, because a driver may finish without arriving;
 * - arrived with a required photo missing: the primary takes it ("Take seal photo", "Scan BOL" for a
 *   document slot, which opens the scanner); completing anyway is the quiet "Complete without photo",
 *   which still asks D21's reason;
 * - nothing missing: "Complete stop".
 * Skip is always quiet and always asks a reason.
 */
export function stopFooter(
  stop: Pick<LoadStop, 'required_photos' | 'photos' | 'status'>,
  captures: readonly SessionCapture[],
): StopFooter {
  const missing = outstandingSlots(stop, captures);
  const skip = { kind: 'skip' as const, label: 'Skip stop' };
  if (stop.status === 'pending') {
    return { primary: { kind: 'arrive', label: 'Mark arrived' }, quiet: [{ kind: 'complete', label: 'Complete stop' }, skip] };
  }
  const next = missing[0];
  if (next !== undefined) {
    const label = isDocumentSlot(next) ? `Scan ${slotNoun(next)}` : `Take ${slotNoun(next)} photo`;
    const anyway = missing.length === 1 ? 'Complete without photo' : `Complete without ${missing.length} photos`;
    return { primary: { kind: 'take', label, slot: next }, quiet: [{ kind: 'complete', label: anyway }, skip] };
  }
  return { primary: { kind: 'complete', label: 'Complete stop' }, quiet: [skip] };
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
