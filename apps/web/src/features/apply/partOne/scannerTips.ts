import { reactive, readonly } from "vue";
import type { TipsKind } from "@/features/apply/capture/liveFrame";

/**
 * Whether this visit has shown the live scanner's tips yet, for each kind of photograph (2026-09-30).
 *
 * The tips are for the FIRST scanner of a kind a driver opens — usually the CDL's front. The back comes one
 * screen later and a retake a moment after that, and showing the same three tips again before each would make a
 * driver tap past them without reading, which is worse than showing them once. So it lives here, above the
 * photo screens, rather than in any of them: each screen is its own `PartOnePhoto`, mounted fresh.
 *
 * ONE FLAG PER KIND (`liveFrame.tipsKind`), not one for the scanner: the medical card shares the licence's
 * tips, but the selfie's are about a face — sunglasses, a window behind you — and a driver who pressed past the
 * licence's has not read them. One flag would skip them on exactly the photograph they were written for.
 *
 * ⚠ Per visit, deliberately not stored on the phone. A driver applies once, a reload mid-application costs one
 * extra tap, and a "don't show again" setting would be one more thing kept on someone else's phone for a
 * screen they will see twice in their life. The mock's checkbox was dropped for that reason.
 */
const seen = reactive<Record<TipsKind, boolean>>({ document: false, face: false });

export const scannerTipsSeen = readonly(seen);

export function markScannerTipsSeen(kind: TipsKind): void {
  seen[kind] = true;
}

/** For a test, which mounts many screens in one module. */
export function resetScannerTips(): void {
  seen.document = false;
  seen.face = false;
}
