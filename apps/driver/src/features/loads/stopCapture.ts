import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { isDocumentSlot } from '@silvicom/shared';
import { newClientId } from '@/data/outbox';
import { scanDocument } from '@/capture/engine';
import { decideCapture } from '@/capture/captureDecision';
import { discardScannerTempFiles } from '@/data/fileStaging';
import type { SessionCapture } from './stopCaptureModel';

/**
 * The camera → process pipeline for one photo slot (Phase 3C). Isolated from the screen so the native
 * surface lives in one place.
 *
 * A thing (trailer, seal, damage) is photographed with the OS camera (expo-image-picker): the capture
 * UX drivers already know. A document is scanned instead (`capturePhotoForSlot` below).
 *
 * The result is ALWAYS re-encoded (expo-image-manipulator): re-encoding is what strips the original
 * EXIF — GPS, the driver's home location, device serials (D12/§21) — and resizes a 12 MP camera frame
 * down to something that uploads on a truck-stop connection. Output is JPEG, which every iOS/Android
 * encoder supports (WEBP encoding is unreliable on iOS); the DB path is just text so the extension is
 * ours to choose (see buildStopPhotos → '.jpg'). Nothing here touches the network.
 */

/** Longest edge for a proof-of-work photo — legible for a BOL/seal, ~150 KB after JPEG q0.6. */
const MAX_WIDTH = 1600;
const JPEG_QUALITY = 0.6;

export type CaptureResult =
  | { ok: true; capture: SessionCapture }
  | { ok: false; reason: 'cancelled' | 'permission' | 'error'; message?: string };

/**
 * One photo for a stop's slot. A DOCUMENT slot (the bill of lading) is SCANNED with the app's one
 * scanner — the same one the hazmat Capture BOL opens (owner, 2026-11-23) — so the page is found,
 * straightened and checked readable before it is kept; a refused page says why, in the scanner's words,
 * and the driver scans again. Every other slot (trailer, seal, damage) is a plain photo of a thing.
 */
export async function capturePhotoForSlot(slot: string): Promise<CaptureResult> {
  return isDocumentSlot(slot) ? scanDocumentForSlot(slot) : photographSlot(slot);
}

async function scanDocumentForSlot(slot: string): Promise<CaptureResult> {
  let scan: Awaited<ReturnType<typeof scanDocument>>;
  try {
    scan = await scanDocument(1);
  } catch (e) {
    return { ok: false, reason: 'error', message: e instanceof Error ? e.message : String(e) };
  }
  // A close is a close, not an error with a sentence.
  if (!scan.ok && scan.reason === 'CAPTURE_CANCELLED') return { ok: false, reason: 'cancelled' };
  const decision = decideCapture(scan, 1);
  if (!decision.accepted) {
    discardScannerTempFiles(decision.discardUris);
    return { ok: false, reason: 'error', message: decision.reasons.join(' ') };
  }
  const page = decision.pages[0]!;
  // The straightened page at full resolution goes through the same re-encode as a photo: it strips any
  // metadata and sizes it for a truck-stop upload, so the slot's file is what it has always been.
  const result = await encodeForSlot(page.originalOfRecord.uri, slot);
  discardScannerTempFiles([...new Set([page.originalOfRecord.uri, page.enhancedColor.uri])]);
  return result;
}

async function photographSlot(slot: string): Promise<CaptureResult> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) return { ok: false, reason: 'permission' };

  let picked: ImagePicker.ImagePickerResult;
  try {
    // exif:false keeps EXIF out of the RESULT object; the re-encode below strips it from the FILE.
    picked = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1, exif: false });
  } catch (e) {
    return { ok: false, reason: 'error', message: e instanceof Error ? e.message : String(e) };
  }

  const asset = picked.assets?.[0];
  if (picked.canceled || !asset) return { ok: false, reason: 'cancelled' };

  return encodeForSlot(asset.uri, slot);
}

async function encodeForSlot(uri: string, slot: string): Promise<CaptureResult> {
  try {
    const context = ImageManipulator.manipulate(uri);
    context.resize({ width: MAX_WIDTH });
    const rendered = await context.renderAsync();
    const out = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY });
    return {
      ok: true,
      capture: {
        photoId: newClientId(),
        slot,
        localUri: out.uri,
        capturedAt: new Date().toISOString(),
      },
    };
  } catch (e) {
    return { ok: false, reason: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}
