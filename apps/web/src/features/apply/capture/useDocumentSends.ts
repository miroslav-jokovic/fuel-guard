import { computed, onScopeDispose, reactive, ref, type Ref } from "vue";
import { BUNDLED_DEFAULT_CONFIG, type RejectionReason } from "@silvicom/capture-engine";
import {
  APPLICATION_CAPTURE_MAX_BYTES,
  APPLICATION_CAPTURE_REQUESTED,
  PART_ONE_CAPTURE_SLOTS,
  captureOrdinalLimit,
  type ApplicationCaptureContentType,
  type ApplicationCaptureSlot,
  type ApplicationCaptureView,
} from "@silvicom/shared";
import { injectLocalCopy, type LocalCopySpec } from "../deviceCopies";
import { APPLY_CAPTURE_TITLES } from "../strings";
import { dropKeptPhoto, keepPhoto, readKeptPhoto, serverIsNewer } from "./photoLocal";
import { captureContentType, stageCapture, DEFAULT_CAPTURE_IO, type CaptureIo } from "./stageCapture";
import { createWebFileProvider, type WebCaptureProvider } from "./webFileProvider";
import { pickImageFile, pickPhotoFromCamera } from "./webImageIo";

/**
 * Part 2's "Your documents" list (HIRING-WORKFLOW-AUDIT-2026-10-31 §4.7, §9 P9) — every paper an
 * applicant may hold, each as a photo or a PDF, and several of the ones that come in several.
 *
 * ── WHY A SECOND COMPOSABLE BESIDE `useApplicationCaptures` ───────────────────────────────────
 * That one is keyed by SLOT — one photograph per slot, the take/look/send screens of Part 1 and the
 * identity step — and it is right for them. This list is keyed by PLACE, (slot, ordinal), because 0534
 * lets a driver send three training certificates; and it sends a PDF as the file the driver holds,
 * where the camera pipeline draws page 1 of a PDF into a picture and drops the rest. The three network
 * acts are the same (`stageCapture`, ordinal passed), the gate is the same provider, and a kept photo
 * is the same `photoLocal` row (keyed by place since P9), so nothing about HOW a capture is sent forks.
 *
 * ── THE LICENCE IS NEVER ASKED FOR AGAIN ──────────────────────────────────────────────────────
 * §4.7: "CDL (already taken → shows the thumbnail, never re-asks)". Part 1 photographed both sides
 * beside the number (AF3); this list shows them as received and offers no button. ⚠ The thumbnail is
 * what THIS browser holds — the server serves slots and dates, never pictures, on an unauthenticated
 * surface (`listCaptures`), and that decision is not this row's to reverse.
 */

/** One place: a slot and which of several. */
export interface DocumentPlace {
  slot: ApplicationCaptureSlot;
  ordinal: number;
}

export type DocumentSendState = "empty" | "working" | "done" | "rejected" | "failed";
/** Why a send failed — the driver's next move differs (see `useApplicationCaptures`' `CaptureFailure`). */
export type DocumentSendFailure = "network" | "not_intact" | "too_large";

export interface DocumentPlaceView extends DocumentPlace {
  state: DocumentSendState;
  reason: RejectionReason | null;
  failure: DocumentSendFailure | null;
  contentType: string | null;
  /** The picture this browser sent, to look at; null for a PDF or a paper sent on an earlier visit. */
  previewUrl: string | null;
}

export interface DocumentGroupView {
  slot: ApplicationCaptureSlot;
  label: string;
  /** Part 1 took it beside the licence number; shown, never asked for again. */
  fromPartOne: boolean;
  places: DocumentPlaceView[];
  /** The next free ordinal, when the slot takes several and has room; else null. */
  next: number | null;
}

const placeKey = (slot: ApplicationCaptureSlot, ordinal: number): string => `${slot}:${ordinal}`;
const isPdf = (file: File): boolean => file.type === "application/pdf" || /\.pdf$/i.test(file.name);

export interface DocumentSendOptions {
  provider?: WebCaptureProvider;
  io?: CaptureIo;
  /** The file picker ("Upload a file"); injectable so a test hands it a file. */
  pickFile?: () => Promise<File | null>;
  local?: Ref<LocalCopySpec | null> | null;
}

export function useDocumentSends(
  token: Ref<string>,
  already: Ref<ApplicationCaptureView[]>,
  options: DocumentSendOptions = {},
) {
  const local_ = options.local !== undefined ? options.local : injectLocalCopy();
  const spec = (): LocalCopySpec | null => local_?.value ?? null;
  const io: CaptureIo = { ...DEFAULT_CAPTURE_IO, ...(options.io ?? {}) };
  const pickFile = options.pickFile ?? (() => pickImageFile("image/*,application/pdf"));
  /** A file the driver already chose, handed to the provider's next `scan()` instead of the camera. */
  let chosen: File | null = null;
  const provider =
    options.provider ??
    createWebFileProvider(BUNDLED_DEFAULT_CONFIG, {
      pick: async () => {
        const file = chosen ?? (await pickPhotoFromCamera("environment"));
        chosen = null;
        return file;
      },
    });

  const places = reactive<Record<string, Omit<DocumentPlaceView, "slot" | "ordinal">>>({});
  const busy = ref<string | null>(null);

  const forget = (key: string): void => {
    const shown = places[key]?.previewUrl;
    if (shown) URL.revokeObjectURL(shown);
  };
  onScopeDispose(() => {
    for (const key of Object.keys(places)) forget(key);
  });

  const stored = (slot: ApplicationCaptureSlot, ordinal: number) =>
    already.value.find((c) => c.slot === slot && (c.ordinal ?? 0) === ordinal) ?? null;

  const viewOf = (slot: ApplicationCaptureSlot, ordinal: number): DocumentPlaceView => {
    const here = places[placeKey(slot, ordinal)];
    const was = stored(slot, ordinal);
    return {
      slot, ordinal,
      state: here?.state ?? (was ? "done" : "empty"),
      reason: here?.reason ?? null,
      failure: here?.failure ?? null,
      contentType: here?.contentType ?? was?.contentType ?? null,
      previewUrl: here?.previewUrl ?? null,
    };
  };

  const groups = computed<DocumentGroupView[]>(() =>
    APPLICATION_CAPTURE_REQUESTED.map((slot) => {
      const limit = captureOrdinalLimit(slot);
      const used = new Set<number>([
        ...already.value.filter((c) => c.slot === slot).map((c) => c.ordinal ?? 0),
        ...Object.keys(places).filter((k) => k.startsWith(`${slot}:`)).map((k) => Number(k.slice(slot.length + 1))),
      ]);
      // A single-document slot is always its one place, sent or not; a multi-document slot lists what it
      // holds (or its first place, empty) and offers the next free ordinal.
      const ordinals = limit === 1 || used.size === 0 ? [0] : [...used].sort((a, b) => a - b);
      const free = Array.from({ length: limit }, (_, i) => i).find((i) => !used.has(i));
      const views = ordinals.map((o) => viewOf(slot, o));
      return {
        slot,
        label: APPLY_CAPTURE_TITLES[slot],
        fromPartOne: PART_ONE_CAPTURE_SLOTS.includes(slot),
        places: views,
        next: limit > 1 && views.every((v) => v.state === "done") && free !== undefined ? free : null,
      };
    }),
  );

  const mark = (slot: ApplicationCaptureSlot, ordinal: number, over: Partial<DocumentPlaceView>): void => {
    const key = placeKey(slot, ordinal);
    places[key] = {
      state: "working", reason: null, failure: null, contentType: null,
      previewUrl: places[key]?.previewUrl ?? null,
      ...over,
    };
  };

  /** start → PUT → confirm, keeping the bytes on the phone until the confirm answers (C3d2). */
  async function send(
    place: DocumentPlace, blob: Blob, contentType: ApplicationCaptureContentType, sha256: string, previewUrl: string | null,
  ): Promise<void> {
    const where = spec();
    try {
      if (where) await keepPhoto(where, place.slot, blob, contentType, sha256, new Date(), place.ordinal);
      await stageCapture(token.value, place.slot, blob, contentType, { ...io, digest: async () => sha256 }, place.ordinal);
      if (where) await dropKeptPhoto(where, place.slot, place.ordinal);
      mark(place.slot, place.ordinal, { state: "done", contentType, previewUrl });
    } catch (e) {
      const notIntact = (e as { code?: string }).code === "capture_not_intact";
      if (notIntact && where) await dropKeptPhoto(where, place.slot, place.ordinal);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      mark(place.slot, place.ordinal, { state: "failed", failure: notIntact ? "not_intact" : "network", previewUrl: null });
    }
  }

  /** A picture through the gate (A7) — the camera's, or a picture file the driver chose. */
  async function sendPicture(place: DocumentPlace): Promise<void> {
    const result = await provider.scan();
    if (!result.ok) {
      if (result.reason === "CAPTURE_CANCELLED") {
        delete places[placeKey(place.slot, place.ordinal)];
        return;
      }
      mark(place.slot, place.ordinal, { state: "rejected", reason: result.reason });
      return;
    }
    const page = result.pages[0];
    const contentType = page ? captureContentType(page.originalOfRecord.mediaType) : null;
    const blob = page ? provider.takeBytes(page.originalOfRecord.uri) : null;
    if (!page || !contentType || !blob) {
      mark(place.slot, place.ordinal, { state: "failed", failure: "network" });
      return;
    }
    forget(placeKey(place.slot, place.ordinal));
    await send(place, blob, contentType, page.integrityHash, page.originalOfRecord.uri);
  }

  async function run(place: DocumentPlace, act: () => Promise<void>): Promise<void> {
    if (busy.value) return;
    busy.value = placeKey(place.slot, place.ordinal);
    mark(place.slot, place.ordinal, { state: "working" });
    try {
      await act();
    } catch {
      mark(place.slot, place.ordinal, { state: "failed", failure: "network" });
    } finally {
      busy.value = null;
    }
  }

  /** "Take photo" — the phone's camera, through the gate. */
  const photo = (place: DocumentPlace): Promise<void> => run(place, () => sendPicture(place));

  /**
   * "Upload a file" — a PDF is sent as it is (after the size check; the server checks it is a PDF),
   * a picture goes through the same gate as the camera's.
   */
  const file = (place: DocumentPlace): Promise<void> =>
    run(place, async () => {
      const picked = await pickFile();
      if (!picked) {
        delete places[placeKey(place.slot, place.ordinal)];
        return;
      }
      if (!isPdf(picked)) {
        chosen = picked;
        await sendPicture(place);
        return;
      }
      if (picked.size > APPLICATION_CAPTURE_MAX_BYTES) {
        mark(place.slot, place.ordinal, { state: "failed", failure: "too_large" });
        return;
      }
      const blob = new Blob([await picked.arrayBuffer()], { type: "application/pdf" });
      await send(place, blob, "application/pdf", await io.digest(blob), null);
    });

  /**
   * A paper this phone kept and the server never confirmed (C3d2): sent again on the next visit, unless
   * the server's is newer. One at a time, as `useApplicationCaptures` replays.
   */
  async function replay(): Promise<void> {
    const where = spec();
    if (!where) return;
    for (const slot of APPLICATION_CAPTURE_REQUESTED) {
      if (PART_ONE_CAPTURE_SLOTS.includes(slot)) continue;
      for (let ordinal = 0; ordinal < captureOrdinalLimit(slot); ordinal++) {
        const kept = await readKeptPhoto(where, slot, new Date(), ordinal);
        if (!kept || places[placeKey(slot, ordinal)]) continue;
        if (serverIsNewer(kept, stored(slot, ordinal)?.capturedAt ?? null)) {
          await dropKeptPhoto(where, slot, ordinal);
          continue;
        }
        const blob = new Blob([kept.bytes], { type: kept.contentType });
        const preview = kept.contentType === "application/pdf" ? null : URL.createObjectURL(blob);
        await run({ slot, ordinal }, () => send({ slot, ordinal }, blob, kept.contentType, kept.integrityHash, preview));
      }
    }
  }
  const replayed = replay();

  return { groups, busy: computed(() => busy.value), photo, file, replayed };
}
