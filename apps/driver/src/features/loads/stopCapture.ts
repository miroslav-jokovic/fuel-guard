import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { newClientId } from '@/data/outbox';
import type { SessionCapture } from './stopCaptureModel';

/**
 * The camera → process pipeline for one photo slot (Phase 3C). Isolated from the screen so the native
 * surface lives in one place.
 *
 * We use the OS camera (expo-image-picker) rather than a custom viewfinder: fewer moving parts, the
 * permission + capture UX drivers already know, and one less thing to keep correct across OS updates.
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

export async function capturePhotoForSlot(slot: string): Promise<CaptureResult> {
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

  try {
    const context = ImageManipulator.manipulate(asset.uri);
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
