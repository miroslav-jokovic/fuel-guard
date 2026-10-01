import { readonly, ref } from "vue";

/**
 * Whether this visit has shown the live scanner's tips yet (2026-09-30).
 *
 * The tips are for the FIRST scanner a driver opens — usually the CDL's front. The back comes one screen
 * later and a retake a moment after that, and showing the same three tips again before each would make a
 * driver tap past them without reading, which is worse than showing them once. So it lives here, above the
 * two photo screens, rather than in either: each screen is its own `PartOnePhoto`, mounted fresh.
 *
 * ⚠ Per visit, deliberately not stored on the phone. A driver applies once, a reload mid-application costs one
 * extra tap, and a "don't show again" setting would be one more thing kept on someone else's phone for a
 * screen they will see twice in their life. The mock's checkbox was dropped for that reason.
 */
const seen = ref(false);

export const scannerTipsSeen = readonly(seen);

export function markScannerTipsSeen(): void {
  seen.value = true;
}

/** For a test, which mounts many screens in one module. */
export function resetScannerTips(): void {
  seen.value = false;
}
