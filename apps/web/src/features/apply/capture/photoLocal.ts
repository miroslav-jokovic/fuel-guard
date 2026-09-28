import type { ApplicationCaptureContentType, ApplicationCaptureSlot } from "@silvicom/shared";
import { copyExpiry, deleteCopy, isLive, putCopy, readCopy, type LocalCopySpec } from "../deviceCopies";

/**
 * A photograph the driver chose to send, kept on the phone until the server confirms it (AW10, C3d2,
 * Q-AW38 (a)).
 *
 * ── WHY THIS AND NOT A RESUMABLE UPLOAD ───────────────────────────────────────────────────────
 * Q-AW38: Supabase's resumable upload uses a fixed 6 MB chunk, and a photograph here is a few hundred
 * kilobytes after the 1568 px WebP encode — so every upload is one chunk, and a cut at 50% restarts from
 * zero either way. What a cut actually cost was the PHOTOGRAPH: it lived only in the page, and a reload
 * meant finding the licence and taking it again. Kept here from "Use this" until `confirm` answers, it is
 * sent again on the next visit, or the moment the phone is back online.
 *
 * ── WHAT IS KEPT, AND FOR HOW LONG ────────────────────────────────────────────────────────────
 * Only a photograph the driver pressed "Use this" on — never one still in review (§6.6.1: nothing leaves
 * the phone's screen before that press, and this is the same line) — and only the encoded bytes the
 * upload sends, never the camera's original. Deleted when `confirm` answers (or refuses it as
 * `capture_not_intact`, when sending it again would change nothing). Q-AW39's lifetime, ruled for Part 1's
 * typed answers, is applied to these too: a licence photograph is at least as sensitive as the number
 * typed from it. The earlier of 72 hours and the link's expiry, and every read sweeps every expired copy.
 *
 * ⚠ Bytes, not a Blob: a Blob in IndexedDB has a history of Safari bugs, and jsdom's Blob cannot be
 * cloned into the store at all, so a test would pass against a path the store never takes.
 */

export const PHOTO_COPY_VERSION = 1;
export const PHOTO_COPY_TTL_MS = 72 * 60 * 60 * 1000;

export interface KeptPhoto {
  key: string;
  version: number;
  slot: ApplicationCaptureSlot;
  bytes: ArrayBuffer;
  contentType: ApplicationCaptureContentType;
  /** The gate's sha256 of these bytes (A7), which `confirm` checks the object against. */
  integrityHash: string;
  /** When "Use this" was pressed, on this phone's clock. */
  keptAt: string;
  expiresAt: string;
}

/** One row per link and slot: a new "Use this" on the same slot replaces the last. */
export const photoKey = (spec: LocalCopySpec, slot: ApplicationCaptureSlot): string => `${spec.key}:${slot}`;

export async function keepPhoto(
  spec: LocalCopySpec,
  slot: ApplicationCaptureSlot,
  blob: Blob,
  contentType: ApplicationCaptureContentType,
  integrityHash: string,
  now: Date = new Date(),
): Promise<void> {
  await putCopy<KeptPhoto>("photos", {
    key: photoKey(spec, slot),
    version: PHOTO_COPY_VERSION,
    slot,
    bytes: await blob.arrayBuffer(),
    contentType,
    integrityHash,
    keptAt: now.toISOString(),
    expiresAt: copyExpiry(now, PHOTO_COPY_TTL_MS, spec.linkExpiresAt),
  });
}

export const readKeptPhoto = (spec: LocalCopySpec, slot: ApplicationCaptureSlot, now: Date = new Date()): Promise<KeptPhoto | null> =>
  readCopy<KeptPhoto>("photos", photoKey(spec, slot), (row) => isLive(row, PHOTO_COPY_VERSION, now));

export const dropKeptPhoto = (spec: LocalCopySpec, slot: ApplicationCaptureSlot): Promise<void> =>
  deleteCopy("photos", photoKey(spec, slot));

/**
 * Is the server's photograph for this slot newer than the kept one? Then the kept one is not sent again.
 * It is either this very photograph (sent, confirmed, and the answer lost with the signal) or one taken
 * since on another device — the desktop handoff (§6.6.6) puts a computer and a phone on the same slot, and
 * replaying the computer's older photograph over the phone's newer one would be the overwrite this whole
 * item exists to prevent.
 *
 * ⚠ Two clocks: `capturedAt` is the server's, `keptAt` the phone's. A phone running slow could make the
 * server's older photograph look newer and drop the kept one, and the driver then sees "Received" beside
 * the earlier picture. The other direction costs only a second upload of the same bytes. No field on the
 * bundle can do better: it serves slots and dates, never hashes (`listCaptures`).
 */
export const serverIsNewer = (kept: KeptPhoto, storedCapturedAt: string | null): boolean =>
  storedCapturedAt !== null && Date.parse(storedCapturedAt) >= Date.parse(kept.keptAt);
