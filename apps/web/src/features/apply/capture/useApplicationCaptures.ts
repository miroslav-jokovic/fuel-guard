import { computed, onScopeDispose, reactive, ref, type Ref } from "vue";
import {
  BUNDLED_DEFAULT_CONFIG,
  type CaptureProvider,
  type RejectionReason,
} from "@silvicom/capture-engine";
import {
  APPLICATION_CAPTURE_REQUESTED,
  APPLICATION_CAPTURE_SLOT_LABELS,
  type ApplicationCaptureContentType,
  type ApplicationCaptureSlot,
  type ApplicationCaptureView,
} from "@silvicom/shared";
import { injectLocalCopy, type LocalCopySpec } from "../deviceCopies";
import { dropKeptPhoto, keepPhoto, readKeptPhoto, serverIsNewer } from "./photoLocal";
import { captureContentType, stageCapture, DEFAULT_CAPTURE_IO, type CaptureIo } from "./stageCapture";
import { createWebFileProvider } from "./webFileProvider";
import { pickImageFile, pickPhotoFromCamera } from "./webImageIo";

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
 * ── TAKE, LOOK, THEN SEND (§6.6.1, C3b2b) ─────────────────────────────────────────────────────
 * Part 1's scanner screen splits the press in two: `take` holds the photograph and shows it large, and
 * only `use` ("Use this") sends it — so a thumb over the licence is seen and retaken before it costs a
 * byte. `capture` keeps the one-press form for the screens that have no preview step.
 *
 * ── EVERY DEPENDENCY IS INJECTABLE, FOR THE REASON A7'S IO WAS ────────────────────────────────
 * The decision this composable makes — what does the driver see after they take a photograph? — must
 * be testable without a camera, a canvas, a network or a GPU. The provider and the calls are
 * therefore parameters with real defaults, exactly as `webImageIo` is behind an interface.
 *
 * The three network acts themselves live in `stageCapture`, shared with the signing ceremony's drawn
 * mark (A8b): two producers that could not be more different — a phone camera through the gate, a
 * finger on a canvas — must not each hold their own idea of what order those calls go in.
 *
 * ── A PHOTOGRAPH SENT IS NEVER TAKEN TWICE (AW10, C3d2, Q-AW38 (a)) ─────────────────────────────
 * "Use this" first writes the photograph to the phone (`photoLocal.ts`), and only `confirm`'s answer
 * deletes it. So a cut mid-upload, a reload, or a phone that drops the tab leaves it there: the next visit
 * puts it back in its slot and sends it again, and a phone coming back online retries a failed send by
 * itself. The driver never has to find the licence and photograph it again.
 */

/**
 * `review` is a photograph in the phone's hands and nowhere else (§6.6.1): taken, shown large, and waiting
 * for "Use this" or "Retake". Nothing has crossed the wire, so leaving the screen costs nothing.
 */
export type CaptureSlotState = "empty" | "working" | "review" | "done" | "rejected" | "failed";

/**
 * Where the picture comes from (§6.6.6). `camera` opens the phone's own camera app (the `capture` input,
 * D-APP11); `file` is "Upload a photo instead", for a driver whose browser was refused the camera, or who
 * photographed the card earlier. Both go through the same provider and the same gate.
 */
export type CaptureSource = "camera" | "file";

/**
 * Why a slot is `failed`, because the driver's next move differs. `network`: the photograph is still
 * held, so "Use this" can be pressed again once the signal is back. `not_intact`: the server re-hashed the
 * object and it was not what was sent, or not a picture (D-AW9, 422 `capture_not_intact`) — pressing
 * again would send the same bytes, so the photograph is let go and only a retake is offered.
 */
export type CaptureFailure = "network" | "not_intact";

export interface CaptureSlotView {
  slot: ApplicationCaptureSlot;
  label: string;
  state: CaptureSlotState;
  /** Why the gate refused, so the driver is told what to fix rather than that "it failed". */
  reason: RejectionReason | null;
  /** Set only when `state` is `failed`. */
  failure: CaptureFailure | null;
  /** A photograph is held in this browser, waiting for "Use this" (§6.6.1). */
  pending: boolean;
  /** Which picker produced the held or last photograph, so "Retake" reopens the same one. */
  source: CaptureSource;
  capturedAt: string | null;
  /**
   * What the driver just sent, to look at (X6). An object URL, or null.
   *
   * ⚠ **This session only, and that is the honest limit rather than a shortcut.** The server returns
   * slots and dates, not pictures — re-serving them would mean a signed read URL per slot on an
   * unauthenticated surface on every page load, which `applicationCaptureContract.ts` decided against
   * for good reason. So a capture taken on a previous visit shows "Received" and no thumbnail, which
   * is true: this is the photograph in this browser's hands, not a view of the bucket.
   */
  previewUrl: string | null;
}

export function useApplicationCaptures(
  token: Ref<string>,
  already: Ref<ApplicationCaptureView[]>,
  options: {
    provider?: CaptureProvider;
    io?: CaptureIo;
    /**
     * The slots this screen asks for, when it is not all of them (AF3). The identity step takes the
     * licence's two sides beside the licence number; the documents screen keeps the whole list.
     */
    only?: readonly ApplicationCaptureSlot[];
    /**
     * Told once a photograph is in the bucket, with the ORIGINAL the driver took (AW5: the CDL's back is
     * read for its barcode). The original, not the staged copy: the upload is downscaled to the model
     * profile's long edge and re-encoded, and a PDF417's modules are exactly the detail that costs.
     * With an injected provider there is no original to hand over, so the staged bytes are.
     */
    onStaged?: (slot: ApplicationCaptureSlot, original: Blob) => void;
    /** Where a photograph waits for `confirm` (C3d2). Defaults to what `ApplyPage` provides; null keeps none. */
    local?: Ref<LocalCopySpec | null> | null;
  } = {},
) {
  const local_ = options.local !== undefined ? options.local : injectLocalCopy();
  const spec = (): LocalCopySpec | null => local_?.value ?? null;
  /** The file the default provider's picker last returned — the original of what it then processed. */
  let picked: File | null = null;
  /**
   * Which picker the next `scan()` opens. A variable the default provider's `pick` reads, rather than a
   * second provider, because the two sources differ ONLY in the input's `capture` attribute — the gate,
   * the downscale and the EXIF strip after it are one pipeline, and two providers would be two of them.
   */
  let source: CaptureSource = "camera";
  const provider =
    options.provider ??
    createWebFileProvider(BUNDLED_DEFAULT_CONFIG, {
      pick: async () => (picked = await (source === "file" ? pickImageFile("image/*") : pickPhotoFromCamera())),
    });
  const io: CaptureIo = { ...DEFAULT_CAPTURE_IO, ...(options.io ?? {}) };

  /** What has happened on this screen. What happened on a previous visit comes from `already`. */
  const local = reactive<Record<string, SlotLocal>>({});
  /**
   * The photograph taken and not yet sent, per slot (§6.6.1) — the page (its object URL is the preview),
   * its content type, and the original file for `onStaged`. Not reactive: a `File` has no business in a
   * proxy, and the view reads `local[slot].pending`, which is.
   */
  const held: Partial<Record<ApplicationCaptureSlot, Held>> = {};
  const busy = ref<ApplicationCaptureSlot | null>(null);

  /**
   * One object URL per slot, at most (X6).
   *
   * ⚠ The rule the revoke below already stated is unchanged: *a phone should not hold four
   * hundred-kilobyte blobs alive because a driver re-took a licence four times.* Keeping one picture
   * per slot does not break it — retaking REPLACES, and the one being replaced is revoked on the
   * spot. What is held is exactly what is on the screen.
   */
  const previews = reactive<Record<string, string | null>>({});

  const forget = (slot: ApplicationCaptureSlot): void => {
    const shown = previews[slot];
    if (shown) URL.revokeObjectURL(shown);
    previews[slot] = null;
    // The held photograph's object URL IS the preview, so letting go of one is letting go of both.
    delete held[slot];
  };

  // The screen can be left at any point — a driver who goes back to the licence step, or closes the
  // tab. Nothing here outlives the component that asked for it.
  onScopeDispose(() => {
    for (const slot of Object.keys(previews)) {
      const shown = previews[slot];
      if (shown) URL.revokeObjectURL(shown);
    }
  });

  const slots = computed<CaptureSlotView[]>(() =>
    (options.only ?? APPLICATION_CAPTURE_REQUESTED).map((slot) => {
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
        failure: here?.failure ?? null,
        pending: here?.pending ?? false,
        source: here?.source ?? "camera",
        capturedAt: here?.capturedAt ?? stored?.capturedAt ?? null,
        previewUrl: previews[slot] ?? null,
      };
    }),
  );

  const mark = (slot: ApplicationCaptureSlot, state: CaptureSlotState, over: Partial<SlotLocal> = {}): void => {
    local[slot] = {
      state,
      reason: null,
      failure: null,
      capturedAt: null,
      pending: Boolean(held[slot]),
      source: local[slot]?.source ?? "camera",
      ...over,
    };
  };

  /**
   * Open the camera (or the file picker) for one slot and HOLD what comes back (§6.6.1).
   *
   * Nothing is uploaded here: a photograph the gate accepts becomes the large preview with "Use this" and
   * "Retake", and only `use` sends it. A rejected capture returns `{ ok: false, reason }` with NO page
   * (A7), so there is deliberately nothing here that could upload one either way.
   */
  async function take(slot: ApplicationCaptureSlot, from: CaptureSource = "camera"): Promise<void> {
    if (busy.value) return;
    busy.value = slot;
    /** What the slot showed before, for a picker the driver closes: nothing happened, so nothing changes. */
    const before = local[slot] ? { ...local[slot] } : null;
    source = from;
    mark(slot, "working", { source: from });
    try {
      const result = await provider.scan();
      if (!result.ok) {
        // Cancelling the picker is not a failure and must not paint one — a driver who pressed Retake
        // and closed the camera is still looking at the photograph they had.
        if (result.reason === "CAPTURE_CANCELLED") {
          if (before) local[slot] = before;
          else delete local[slot];
        } else {
          forget(slot);
          mark(slot, "rejected", { reason: result.reason, source: from, pending: false });
        }
        return;
      }
      const page = result.pages[0];
      const contentType = page ? captureContentType(page.originalOfRecord.mediaType) : null;
      if (!page || !contentType) {
        if (page) URL.revokeObjectURL(page.originalOfRecord.uri);
        forget(slot);
        mark(slot, "failed", { failure: "network", source: from, pending: false });
        return;
      }
      // The new photograph REPLACES whatever the slot showed, and that one is revoked on the spot (X6).
      forget(slot);
      held[slot] = { uri: page.originalOfRecord.uri, integrityHash: page.integrityHash, contentType, original: picked };
      previews[slot] = page.originalOfRecord.uri;
      mark(slot, "review", { source: from, pending: true });
    } catch {
      mark(slot, "failed", { failure: "network", source: from });
    } finally {
      // A phone photograph is megabytes; `held` keeps the one on screen, this does not keep another.
      picked = null;
      busy.value = null;
    }
  }

  /**
   * "Use this" — put the held photograph in the bucket (start → PUT → confirm, `stageCapture`).
   *
   * On a network failure the photograph stays held, so the same button works once the signal is back; on
   * `capture_not_intact` it is let go, because sending the same bytes again gets the same answer.
   */
  async function use(slot: ApplicationCaptureSlot): Promise<void> {
    const photo = held[slot];
    if (busy.value || !photo) return;
    busy.value = slot;
    mark(slot, "working");
    try {
      // The provider hands back an object URL rather than the blob; reading it back is how the bytes
      // are recovered without widening the engine's contract for one consumer.
      const blob: Blob = photo.blob !== undefined ? photo.blob : await fetch(photo.uri).then((r) => r.blob());
      // C3d2: on the phone BEFORE the first byte goes, so no cut after this point can lose it. A put that
      // fails (storage blocked) resolves, and the send goes ahead as it did before C3d2.
      const where = spec();
      if (where && !photo.kept) await keepPhoto(where, slot, blob, photo.contentType, photo.integrityHash);
      // The gate already hashed these exact bytes (A7), so the digest is passed through rather than
      // recomputed — the shared path takes an io whose `digest` is a function for the callers that
      // have no hash of their own.
      const confirmed = await stageCapture(token.value, slot, blob, photo.contentType, {
        ...io,
        digest: async () => photo.integrityHash,
      });
      if (where) await dropKeptPhoto(where, slot);
      // Sent: no longer held, but still the picture on the screen (X6) — `previews` keeps its URL.
      delete held[slot];
      mark(slot, "done", { capturedAt: confirmed.capturedAt, pending: false });
      options.onStaged?.(slot, photo.original ?? blob);
    } catch (e) {
      if ((e as { code?: string }).code === "capture_not_intact") {
        // The server has refused these exact bytes; sending them again gets the same answer.
        const where = spec();
        if (where) await dropKeptPhoto(where, slot);
        forget(slot);
        mark(slot, "failed", { failure: "not_intact", pending: false });
      } else {
        // One state for every network failure, because the driver's action is the same for all of
        // them: try again when the signal comes back.
        mark(slot, "failed", { failure: "network" });
      }
    } finally {
      busy.value = null;
    }
  }

  /**
   * Take and send in one press, for the screens with no preview step (the documents list, the legacy
   * identity step). A photograph that did not reach the bucket is let go rather than left held behind a
   * button those screens do not have — there is nothing to show and nothing to keep.
   */
  async function capture(slot: ApplicationCaptureSlot): Promise<void> {
    // Read through a function: after `take` narrows the state to "review", TypeScript would otherwise
    // hold that narrowing across `use`, which is exactly the call that changes it.
    const stateOf = (): CaptureSlotState | undefined => local[slot]?.state;
    await take(slot);
    if (stateOf() !== "review") return;
    await use(slot);
    if (stateOf() !== "done") {
      forget(slot);
      if (local[slot]) local[slot].pending = false;
    }
  }

  /**
   * A photograph this phone chose and the server never confirmed (C3d2): back in its slot, shown, and sent.
   * If the send fails again it stays held — "Use this" works as always, and so does coming back online.
   * Not when this screen already has a photograph of its own, and not over a newer one on the server
   * (`serverIsNewer`: the same photograph, landed; or one taken since on another device).
   */
  async function replay(slot: ApplicationCaptureSlot): Promise<void> {
    const where = spec();
    if (!where) return;
    const kept = await readKeptPhoto(where, slot);
    // Checked AFTER the read: the driver may have taken a photograph on this screen while it ran, and
    // theirs is the newer one.
    if (!kept || held[slot] || local[slot]) return;
    const stored = already.value.find((c) => c.slot === slot) ?? null;
    if (serverIsNewer(kept, stored?.capturedAt ?? null)) {
      await dropKeptPhoto(where, slot);
      return;
    }
    const blob = new Blob([kept.bytes], { type: kept.contentType });
    const uri = URL.createObjectURL(blob);
    forget(slot);
    held[slot] = { uri, blob, integrityHash: kept.integrityHash, contentType: kept.contentType, original: null, kept: true };
    previews[slot] = uri;
    mark(slot, "review", { pending: true });
    await use(slot);
  }

  // One at a time — `use` refuses while another slot is busy, so a parallel replay would skip slots.
  const replayAll = async (): Promise<void> => {
    for (const slot of options.only ?? APPLICATION_CAPTURE_REQUESTED) await replay(slot);
  };
  const replayed = replayAll();

  /** Back online: a send that failed on the signal goes again by itself (the button still works too). */
  const onOnline = (): void => {
    void (async () => {
      for (const slot of options.only ?? APPLICATION_CAPTURE_REQUESTED) {
        if (held[slot] && local[slot]?.state === "failed" && local[slot]?.failure === "network") await use(slot);
      }
    })();
  };
  if (typeof window !== "undefined") {
    window.addEventListener("online", onOnline);
    onScopeDispose(() => window.removeEventListener("online", onOnline));
  }

  return {
    slots,
    busy: computed(() => busy.value),
    take,
    use,
    capture,
    /** Settles once any photograph kept from an earlier visit has been put back and sent (or tried). */
    replayed,
  };
}

interface SlotLocal {
  state: CaptureSlotState;
  reason: RejectionReason | null;
  failure: CaptureFailure | null;
  capturedAt: string | null;
  pending: boolean;
  source: CaptureSource;
}

interface Held {
  /** The encoded photograph's object URL — also the preview. */
  uri: string;
  /** The gate's sha256 of those bytes (A7). */
  integrityHash: string;
  contentType: ApplicationCaptureContentType;
  /**
   * What the picker returned — handed on by `onStaged`; null when an injected provider had no picker, and
   * for a photograph put back from the phone (C3d2), which keeps only the encoded bytes. So a CDL back sent
   * on a later visit is read for its barcode from the downscaled copy, which may not read.
   */
  original: File | null;
  /** Put back from the phone (C3d2): already kept, so `use` does not write it again. */
  kept?: boolean;
  /** The bytes themselves, when they are already in hand (a put-back photograph), so `use` need not re-read its own URL. */
  blob?: Blob;
}
