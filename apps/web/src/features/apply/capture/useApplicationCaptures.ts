import { computed, reactive, ref, type Ref } from "vue";
import {
  BUNDLED_DEFAULT_CONFIG,
  type CaptureProvider,
  type RejectionReason,
} from "@fuelguard/capture-engine";
import {
  APPLICATION_CAPTURE_REQUESTED,
  APPLICATION_CAPTURE_SLOT_LABELS,
  type ApplicationCaptureSlot,
  type ApplicationCaptureView,
} from "@fuelguard/shared";
import { captureContentType, stageCapture, DEFAULT_CAPTURE_IO, type CaptureIo } from "./stageCapture";
import { createWebFileProvider } from "./webFileProvider";

/**
 * One photograph per slot, from the driver's own phone (A8, D-APP10).
 *
 * ── THE THREE THINGS THAT CAN HAPPEN, AND WHY ONLY ONE OF THEM COSTS BYTES ────────────────────
 * The gate (A7) runs in the browser, so a blurry or low-resolution photograph is refused BEFORE any
 * request is made: a driver re-shooting four times in a truck-stop car park pays for none of them.
 * Only an accepted photograph reaches the network, and then it does so twice — a call for somewhere
 * to put it, a PUT straight to Storage, and a call to say it landed. The row is written last, so a
 * failed upload leaves no slot claiming to be filled.
 *
 * ── EVERY DEPENDENCY IS INJECTABLE, FOR THE REASON A7'S IO WAS ────────────────────────────────
 * The decision this composable makes — what does the driver see after they take a photograph? — must
 * be testable without a camera, a canvas, a network or a GPU. The provider and the calls are
 * therefore parameters with real defaults, exactly as `webImageIo` is behind an interface.
 *
 * The three network acts themselves live in `stageCapture`, shared with the signing ceremony's drawn
 * mark (A8b): two producers that could not be more different — a phone camera through the gate, a
 * finger on a canvas — must not each hold their own idea of what order those calls go in.
 */

export type CaptureSlotState = "empty" | "working" | "done" | "rejected" | "failed";

export interface CaptureSlotView {
  slot: ApplicationCaptureSlot;
  label: string;
  state: CaptureSlotState;
  /** Why the gate refused, so the driver is told what to fix rather than that "it failed". */
  reason: RejectionReason | null;
  capturedAt: string | null;
}

export function useApplicationCaptures(
  token: Ref<string>,
  already: Ref<ApplicationCaptureView[]>,
  options: { provider?: CaptureProvider; io?: CaptureIo } = {},
) {
  const provider = options.provider ?? createWebFileProvider(BUNDLED_DEFAULT_CONFIG);
  const io: CaptureIo = { ...DEFAULT_CAPTURE_IO, ...(options.io ?? {}) };

  /** What has happened on this screen. What happened on a previous visit comes from `already`. */
  const local = reactive<Record<string, { state: CaptureSlotState; reason: RejectionReason | null; capturedAt: string | null }>>({});
  const busy = ref<ApplicationCaptureSlot | null>(null);

  const slots = computed<CaptureSlotView[]>(() =>
    APPLICATION_CAPTURE_REQUESTED.map((slot) => {
      const here = local[slot];
      // A slot the server already knows about is done, whatever this tab has done since — a resumed
      // session must not ask a driver to photograph a licence they photographed last week.
      const stored = already.value.find((c) => c.slot === slot) ?? null;
      const state: CaptureSlotState = here?.state ?? (stored ? "done" : "empty");
      return {
        slot,
        label: APPLICATION_CAPTURE_SLOT_LABELS[slot],
        state,
        reason: here?.reason ?? null,
        capturedAt: here?.capturedAt ?? stored?.capturedAt ?? null,
      };
    }),
  );

  const mark = (
    slot: ApplicationCaptureSlot,
    state: CaptureSlotState,
    reason: RejectionReason | null = null,
    capturedAt: string | null = null,
  ): void => {
    local[slot] = { state, reason, capturedAt };
  };

  /**
   * Open the camera for one slot and, if the gate accepts what comes back, put it in the bucket.
   *
   * A rejected capture returns `{ ok: false, reason }` with NO page (A7), so there is deliberately
   * nothing here that could upload one — the refusal is a state on the screen, not a round trip.
   */
  async function capture(slot: ApplicationCaptureSlot): Promise<void> {
    if (busy.value) return;
    busy.value = slot;
    mark(slot, "working");
    try {
      const result = await provider.scan();
      if (!result.ok) {
        // Cancelling the picker is not a failure and must not paint one: the driver closed the
        // camera, and the slot goes back to where it was.
        if (result.reason === "CAPTURE_CANCELLED") delete local[slot];
        else mark(slot, "rejected", result.reason);
        return;
      }
      const page = result.pages[0];
      const contentType = page ? captureContentType(page.originalOfRecord.mediaType) : null;
      if (!page || !contentType) {
        mark(slot, "failed");
        return;
      }

      // The provider hands back an object URL rather than the blob; reading it back is how the bytes
      // are recovered without widening the engine's contract for one consumer.
      const blob = await fetch(page.originalOfRecord.uri).then((r) => r.blob());
      try {
        // The gate already hashed these exact bytes (A7), so the digest is passed through rather
        // than recomputed — the shared path takes an io whose `digest` is a function for the callers
        // that have no hash of their own.
        const confirmed = await stageCapture(token.value, slot, blob, contentType, {
          ...io,
          digest: async () => page.integrityHash,
        });
        mark(slot, "done", null, confirmed.capturedAt);
      } finally {
        // The photograph is in the bucket (or it is not); either way a phone should not hold four
        // hundred-kilobyte blobs alive because a driver re-took a licence four times.
        URL.revokeObjectURL(page.originalOfRecord.uri);
      }
    } catch {
      // One state for every network failure, because the driver's action is the same for all of
      // them: try again when the signal comes back.
      mark(slot, "failed");
    } finally {
      busy.value = null;
    }
  }

  return {
    slots,
    busy: computed(() => busy.value),
    capture,
  };
}
