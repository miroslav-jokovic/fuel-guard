<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { signingPlaceDestination } from "@silvicom/shared";
import { loadPdfDocument as loadDocument } from "@/features/apply/signing/pdfDocument";
import { placeBoxOnPage } from "@/features/apply/signing/signatureBox";
import type { LocatedPlaces } from "@/features/apply/signing/signingPlaces";

/**
 * One page of a document being signed place by place, drawn on a canvas — the carrier's packet and the
 * handbook alike (C1; D-HB12 made it both documents' viewer, 2026-09-29, and renamed it from
 * `PacketPageView`).
 *
 * ── THE PLACES (D-HB12) ───────────────────────────────────────────────────────────────────────
 * Each place is named inside the PDF (`sign:<id>`, a `FitR` box). After loading, this resolves every
 * id it was handed and emits `located` — which page each is on, and where — because only the bytes
 * know that for the handbook, whose text flows. The `tag` slot hangs over the box of `tagPlaceId`
 * whenever its page is the one on screen: that is the **Sign here** tag, the same act the permissions'
 * viewer already performs over its one box.
 *
 * ── ⚠ WHY NOT `DocumentPreview.vue` ───────────────────────────────────────────────────────────
 * B8's viewer is an `<iframe>` on a blob, and its own header says this: *"the read-only half is
 * shared; the signing half is not, and C1 should not open expecting it."* An iframe gives none of
 * what a signing walk needs — you cannot address a page inside it, you cannot know which page the
 * driver is looking at, and you cannot draw over it. So this is a second VIEWER and emphatically not
 * a second renderer: the bytes both show come from one place, and nothing here decides what the
 * document says.
 *
 * ── THE RECIPE IS `lib/pdfWords.ts`, NOT AN EXTENSION OF IT ───────────────────────────────────
 * That module already solves the fiddly half — the dynamic import and the worker URL — and is
 * deliberately thin: its job is words-with-positions for vendor statements, and rendering a page is
 * a different job in the same library. ⚠ The dynamic import is copied for its REASON, not its shape:
 * pdfjs is large, and an applicant reaching screen three of eight should not download a PDF engine
 * to fill in their address history. It is paid for at the moment the ceremony opens and not before.
 *
 * ── ⚠ THE BYTES ARE FETCHED ONCE ──────────────────────────────────────────────────────────────
 * A0b gave `POST /:token/mark` its own bucket — 60 per minute, keyed per link — and everything else
 * on `/api/public/application` falls to the intake bucket at **20 per minute per address**. A viewer
 * that fetched a page at a time would be a new request pattern on that prefix and a thirty-one-page
 * document would spend the whole budget on the first scroll, with the driver told their link was
 * invalid. So: one GET, one `ArrayBuffer`, every page rendered from it.
 *
 * ── AND WHY IT RE-RENDERS ON RESIZE ───────────────────────────────────────────────────────────
 * ⚠ The container's width is not known at mount and legitimately changes twice: the apply layout
 * widens a frame after the page asks it to (`lib/layout.ts` records the same ordering problem for
 * the live map), and a phone rotates. A canvas rasterised at the wrong width is soft rather than
 * broken, which is the kind of defect that ships — D-HUI9 measured body text at ~6 CSS px on a
 * 390px viewport, so there is no margin to lose. A `ResizeObserver` re-rasterises at the width the
 * page actually has.
 */
const props = defineProps<{
  /** Where the bytes are. Fetched exactly once; changing it re-fetches. */
  src: string;
  /** The carrier's own page number, 1-based — `PacketPlacement.page` passes straight through. */
  page: number;
  /** For the accessible name, since the canvas itself is an image of a document. */
  label: string;
  /** The places to find in the document (D-HB12). */
  places?: readonly string[];
  /** The place whose box carries the `tag` slot, when its page is on screen. */
  tagPlaceId?: string | null;
}>();
const emit = defineEmits<{ loaded: [pageCount: number]; failed: []; located: [places: LocatedPlaces] }>();

/** Where each place is, read from the bytes on screen. Empty until they load, and for a document without names. */
const located = ref<LocatedPlaces>({});

/**
 * ⚠ One lookup per place and a failure costs that place only: a document whose destinations do not
 * resolve still shows its pages, and the walk falls back to its plain Sign button (`PlaceWalk`).
 */
async function locate(d: NonNullable<typeof doc.value>): Promise<LocatedPlaces> {
  const out: LocatedPlaces = {};
  for (const id of props.places ?? []) {
    try {
      const dest = await d.getDestination(signingPlaceDestination(id));
      if (!dest) continue;
      const index = await d.getPageIndex(dest[0] as Parameters<typeof d.getPageIndex>[0]);
      const box = placeBoxOnPage(dest, (await d.getPage(index + 1)).view);
      if (box) out[id] = { page: index + 1, box };
    } catch {
      // Not found, or not a box: this place has no tag.
    }
  }
  return out;
}

const canvas = ref<HTMLCanvasElement | null>(null);
const frame = ref<HTMLDivElement | null>(null);
const state = ref<"loading" | "ready" | "failed">("loading");
const pageCount = ref(0);

/**
 * ⚠ `shallowRef`, not `ref`. A pdfjs document is a large object graph with live worker handles;
 * making it deeply reactive would have Vue walk it on every access and can resurrect destroyed
 * proxies. Nothing in the template reads inside it.
 */
const doc = shallowRef<Awaited<ReturnType<typeof loadDocument>>["doc"] | null>(null);
/**
 * ⚠ The LOADING TASK is what owns the worker, and `task.destroy()` is what releases it —
 * `pdfWords.ts` holds it for the same reason. A leaked worker survives every subsequent ceremony in
 * the tab, and this screen is one a driver may open several times.
 */
let task: Awaited<ReturnType<typeof loadDocument>>["task"] | null = null;
let destroyed = false;
/** The width the current raster was drawn at, so a resize that changes nothing does not redraw. */
let drawnWidth = 0;
let drawnPage = 0;

// The import, the worker and the one fetch live in `pdfDocument.ts` since AF6, shared with the
// permissions' viewer. ⚠ `credentials: "omit"` and fetched ONCE, for the reasons in the header.

/**
 * ⚠ **One render at a time, and this is not defensiveness — it was a page error in the browser.**
 * pdfjs refuses overlapping `render()` calls on one canvas (*"Cannot use the same canvas during
 * multiple render operations"*), and `draw()` has three independent callers: the document finishing
 * loading, the walk moving to the next stop, and the `ResizeObserver`, which fires twice on this
 * screen because the apply layout widens a frame after the page asks it to. Two of them overlap on
 * the first paint every time. The in-flight render is CANCELLED rather than awaited, because the
 * reason a new one started is always that the old one's output is already stale.
 */
let inFlight: { cancel(): void } | null = null;

async function draw(): Promise<void> {
  const d = doc.value;
  const el = canvas.value;
  const box = frame.value;
  if (!d || !el || !box) return;
  const width = Math.floor(box.clientWidth);
  if (width <= 0) return;
  const n = Math.min(Math.max(props.page, 1), d.numPages);
  if (width === drawnWidth && n === drawnPage) return;

  inFlight?.cancel();
  inFlight = null;

  const pdfPage = await d.getPage(n);
  try {
    const base = pdfPage.getViewport({ scale: 1 });
    // ⚠ The device pixel ratio is applied to the BACKING STORE and the CSS width is left alone, so
    // the page occupies the width it was given and is rasterised at the density the screen can
    // actually show. Capped at 2: a 3x phone would triple the memory of a 31-page document's raster
    // for a sharpness nobody can see on a scanned form.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const scale = width / base.width;
    const viewport = pdfPage.getViewport({ scale: scale * dpr });
    el.width = Math.floor(viewport.width);
    el.height = Math.floor(viewport.height);
    el.style.width = `${width}px`;
    el.style.height = `${Math.floor(viewport.height / dpr)}px`;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    const task = pdfPage.render({ canvas: el, canvasContext: ctx, viewport });
    inFlight = task;
    try {
      await task.promise;
    } catch (e) {
      // A cancelled render is the ordinary case here, not a failure: a resize or a turned page
      // superseded it, and the render that superseded it will set the state. ⚠ Anything else is
      // reported rather than thrown — two of `draw`'s three callers are `void draw()` on a watcher,
      // where a throw is an unhandled rejection and the screen simply stops updating.
      if ((e as { name?: string })?.name !== "RenderingCancelledException" && !destroyed) {
        state.value = "failed";
        emit("failed");
      }
      return;
    } finally {
      if (inFlight === task) inFlight = null;
    }
    drawnWidth = width;
    drawnPage = n;
    if (!destroyed) state.value = "ready";
  } finally {
    pdfPage.cleanup();
  }
}

async function load(): Promise<void> {
  state.value = "loading";
  drawnWidth = 0;
  drawnPage = 0;
  // A second load (the src changed) must release the first, or two workers sit on one screen.
  await task?.destroy();
  task = null;
  doc.value = null;
  try {
    const loaded = await loadDocument(props.src);
    if (destroyed) {
      await loaded.task.destroy();
      return;
    }
    task = loaded.task;
    doc.value = loaded.doc;
    pageCount.value = loaded.doc.numPages;
    located.value = await locate(loaded.doc);
    emit("located", located.value);
    await draw();
    emit("loaded", loaded.doc.numPages);
  } catch {
    if (destroyed) return;
    state.value = "failed";
    // ⚠ No console.error and no message body. This is somebody's employment history; a failure to
    // draw it is reported to the driver as a sentence and to nobody else.
    emit("failed");
  }
}

watch(() => props.src, load, { immediate: true });

/** The tagged place's box, only while its page is the one drawn. */
const tagBox = computed(() => {
  const at = props.tagPlaceId ? located.value[props.tagPlaceId] : undefined;
  return at && at.page === Math.min(Math.max(props.page, 1), pageCount.value || props.page) ? at.box : null;
});
// ⚠ Page changes redraw from the document already in memory — never a second fetch. See the header.
watch(() => props.page, () => void draw());

let observer: ResizeObserver | null = null;
watch(frame, (el) => {
  observer?.disconnect();
  if (!el) return;
  observer = new ResizeObserver(() => void draw());
  observer.observe(el);
});

onBeforeUnmount(() => {
  destroyed = true;
  observer?.disconnect();
  // Releases the worker. A leaked one survives every subsequent ceremony in the same tab.
  void task?.destroy();
  task = null;
  doc.value = null;
});
</script>

<template>
  <div ref="frame" class="w-full">
    <!-- ⚠ The canvas stays MOUNTED through loading and failure. `frame` is what the observer
         watches and what `draw()` measures, and a `v-if` that swapped it out would take the width
         with it — the first raster would then be drawn at zero and the driver would see nothing. -->
    <div class="relative w-full overflow-hidden rounded-surface border border-edge bg-surface">
      <canvas
        ref="canvas"
        class="block w-full"
        role="img"
        :aria-label="label"
      />
      <!-- The Sign here tag, over the place's own box, in percentages of the page so it stays on the
           box at every width. Hung from the box's TOP, `PermissionDocumentView`'s reason: a 44 px tag
           over a short box grows down over the rule, never up over the words above it. -->
      <div
        v-if="state === 'ready' && tagBox"
        class="absolute flex items-start"
        :style="{ left: `${tagBox.left}%`, top: `${tagBox.top}%`, width: `${tagBox.width}%`, height: `${tagBox.height}%` }"
      >
        <slot name="tag" />
      </div>
      <div
        v-if="state !== 'ready'"
        class="absolute inset-0 flex items-center justify-center bg-surface p-6 text-center"
      >
        <p class="text-sm text-ink-muted">
          {{ state === "loading" ? "Getting the page…" : "The page could not be shown." }}
        </p>
      </div>
    </div>
  </div>
</template>
