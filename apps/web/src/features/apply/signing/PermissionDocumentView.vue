<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { PERMISSION_SIGNATURE_DESTINATION } from "@silvicom/shared";
import { loadPdfDocument, type LoadedPdf } from "@/features/apply/signing/pdfDocument";
import { signatureBoxOnPage, type BoxOnPage } from "@/features/apply/signing/signatureBox";

/**
 * One permission, every page of it, with the signature box marked (AF6, D-AF2).
 *
 * ── WHY A SECOND VIEWER AND NOT `PacketPageView` ──────────────────────────────────────────────
 * The packet ceremony shows ONE page at a time, because the applicant walks twenty places on a
 * thirty-one-page document and the rail carries them between pages. A permission is read whole before
 * it is signed: the PSP form runs to two pages and its signature is at the end of the text, above
 * FMCSA's notices. So this stacks every page, and puts a slot over the box the renderer named inside
 * the PDF (`signatureBox.ts`). The parent decides what goes there: the **Sign here** tag, or the
 * signed mark. The import, the worker and the single fetch are shared (`pdfDocument.ts`).
 *
 * ⚠ **The bytes are fetched once** and on the ceremony's per-link bucket (AF6a): five documents plus
 * the page's own reads would crowd the intake's 20 a minute.
 *
 * ⚠ **A failure is reported and never swallowed into an empty frame.** The parent falls back to the
 * words, which it holds anyway (`APPLY_COPY.permissions.unavailable`), so a document that will not
 * load costs the picture and never the signature.
 */
const props = defineProps<{ src: string; label: string }>();
const emit = defineEmits<{ loaded: [hasBox: boolean]; failed: [] }>();

const frame = ref<HTMLDivElement | null>(null);
const canvases = ref<HTMLCanvasElement[]>([]);
const state = ref<"loading" | "ready" | "failed">("loading");
const pageCount = ref(0);
/** The page (0-based) the box is on, and where on it. Null when the document names no box. */
const box = ref<{ page: number; at: BoxOnPage } | null>(null);

/** ⚠ `shallowRef`: a pdfjs document is a live object graph; deep reactivity would walk it. */
const doc = shallowRef<LoadedPdf["doc"] | null>(null);
let task: LoadedPdf["task"] | null = null;
let destroyed = false;
let drawnWidth = 0;
/** One render per canvas at a time; a new one cancels the stale one (`PacketPageView`'s reason). */
const inFlight = new Map<number, { cancel(): void }>();

async function findBox(d: LoadedPdf["doc"]): Promise<{ page: number; at: BoxOnPage } | null> {
  try {
    const dest = await d.getDestination(PERMISSION_SIGNATURE_DESTINATION);
    if (!dest) return null;
    const page = await d.getPageIndex(dest[0] as Parameters<typeof d.getPageIndex>[0]);
    const at = signatureBoxOnPage(dest, (await d.getPage(page + 1)).view);
    return at ? { page, at } : null;
  } catch {
    return null;
  }
}

async function drawPage(d: LoadedPdf["doc"], index: number, width: number): Promise<void> {
  const el = canvases.value[index];
  if (!el) return;
  inFlight.get(index)?.cancel();
  const pdfPage = await d.getPage(index + 1);
  try {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const base = pdfPage.getViewport({ scale: 1 });
    const viewport = pdfPage.getViewport({ scale: (width / base.width) * dpr });
    el.width = Math.floor(viewport.width);
    el.height = Math.floor(viewport.height);
    el.style.width = `${width}px`;
    el.style.height = `${Math.floor(viewport.height / dpr)}px`;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    const render = pdfPage.render({ canvas: el, canvasContext: ctx, viewport });
    inFlight.set(index, render);
    try {
      await render.promise;
    } finally {
      if (inFlight.get(index) === render) inFlight.delete(index);
    }
  } finally {
    pdfPage.cleanup();
  }
}

async function draw(): Promise<void> {
  const d = doc.value;
  const width = Math.floor(frame.value?.clientWidth ?? 0);
  if (!d || width <= 0 || width === drawnWidth) return;
  drawnWidth = width;
  try {
    for (let i = 0; i < d.numPages; i += 1) await drawPage(d, i, width);
    if (!destroyed) state.value = "ready";
  } catch (e) {
    // A cancelled render is a resize superseding it; anything else is a failure, said out loud.
    if ((e as { name?: string })?.name !== "RenderingCancelledException" && !destroyed) {
      state.value = "failed";
      emit("failed");
    }
  }
}

async function load(): Promise<void> {
  state.value = "loading";
  drawnWidth = 0;
  box.value = null;
  await task?.destroy();
  task = null;
  doc.value = null;
  try {
    const loaded = await loadPdfDocument(props.src);
    if (destroyed) {
      await loaded.task.destroy();
      return;
    }
    task = loaded.task;
    doc.value = loaded.doc;
    box.value = await findBox(loaded.doc);
    pageCount.value = loaded.doc.numPages;
    // The canvases are rendered by `v-for` over `pageCount`; wait for them before drawing on them.
    await nextTick();
    await draw();
    emit("loaded", box.value !== null);
  } catch {
    if (destroyed) return;
    state.value = "failed";
    emit("failed");
  }
}

watch(() => props.src, load, { immediate: true });

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
  void task?.destroy();
  task = null;
  doc.value = null;
});
</script>

<template>
  <div ref="frame" class="w-full space-y-3">
    <p v-if="state === 'loading'" class="text-sm text-ink-muted"><slot name="loading" /></p>
    <div
      v-for="n in pageCount"
      :key="n"
      class="relative w-full overflow-hidden rounded-surface border border-edge bg-surface"
    >
      <canvas
        :ref="(el) => { if (el) canvases[n - 1] = el as HTMLCanvasElement; }"
        class="block w-full"
        role="img"
        :aria-label="`${label}, page ${n} of ${pageCount}`"
      />
      <!-- Over the box the renderer drew, in percentages of this page, so it stays on the box at
           every width the page is drawn at. -->
      <div
        v-if="state === 'ready' && box && box.page === n - 1"
        class="absolute flex items-end"
        :style="{
          left: `${box.at.left}%`,
          top: `${box.at.top}%`,
          width: `${box.at.width}%`,
          height: `${box.at.height}%`,
        }"
      >
        <slot name="box" />
      </div>
    </div>
  </div>
</template>
