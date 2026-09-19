<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type { DocumentRow } from "@silvicom/shared";
import { AppIcon, AppButton as BaseButton } from "@silvicom/ui";
import { ArrowDownTrayIcon, PrinterIcon } from "@silvicom/ui/icons";
import BaseModal from "@/components/ui/BaseModal.vue";
import { apiFetch, fetchObjectUrl } from "@/lib/api";
import { saveObjectUrl, type RenderedDocument } from "@/lib/documentDownload";
import { useToastStore } from "@/stores/toast";
import { formatDate } from "@/lib/format";

/**
 * The sanctioned document viewer (DQF plan B6) — the only place a compliance scan is looked at
 * full-size. Mounted in `BaseModal size="xl"` because a medical card at drawer width is not
 * legible (B5).
 *
 * ── WHY IT LIVES HERE RATHER THAN IN `features/compliance` (R5a, 2026-08-31) ────────────────────
 * It was written inside that feature and the design contract §1.2 has ALWAYS listed it among the
 * shared components — with "(features/compliance)" beside it, admitting the file was somewhere the
 * table said it was not. R5 needs it from the roster (D-ROS8's documents modal) and D-ROS10 will
 * need it for tractors and trailers, whose `subject_type` the storage path already accepts. A
 * `roster` component may not import a `compliance` one (`lint:boundaries`), and
 * `check-feature-boundaries.mjs` says in its own comment what to do about that: promote the shared
 * thing out of `features/`, never allow-list the leak.
 *
 * Nothing about the component changed in the move — it had no compliance imports to begin with,
 * which is the clearest sign it was never a feature's own.
 *
 * What loads what: the table cell showed the 40 KB `thumb`; this modal shows `normalized`
 * (2000 px, legible down to a certificate number); the 25 MB ORIGINAL is fetched only by the
 * Download button, as a server-signed attachment — never rendered into the page.
 *
 * PDFs (D-DQ9): the browser's own viewer in an iframe on the signed original. No Print button for
 * them — the PDF viewer owns that toolbar, and window.print() from here would print an empty frame;
 * a button that silently does nothing is worse than no button.
 *
 * ── THE SECOND SOURCE: A DOCUMENT WITH NO ROW (B8, 2026-09-18) ────────────────────────────────
 * `doc` is a FILED document: a `documents` row, signed storage URLs, a hash. `rendered` is the other
 * kind this API serves — `preview.pdf` and B2's permissions PDF — composed from the current rows on
 * every request and deliberately never stored. Those had no way in here at all, so their only reader
 * was `documentDownload.ts`'s `openPdf`, which opens a NEW TAB and takes the reviewer away from the
 * record they were reading the document against. That is the gap B8 exists to close, and closing it
 * by teaching this viewer a second source is the alternative to a second viewer (D-DS18).
 *
 * ⚠ The two sources are not symmetrical, and the footer is where that shows. A filed document prints
 * its kind, its capture date and its hash, because §390.32(c) is a claim about stored bytes. A
 * rendered one has none of those and says so instead of showing a blank hash — evidence it does not
 * have would be worse than the absence.
 *
 * ⚠ The object URL is owned HERE and revoked on close, where `openPdf` has to guess with a 60-second
 * timer because it hands the URL to a tab it cannot observe. A modal knows exactly when it is done.
 *
 * ── WHAT C1 CANNOT INHERIT FROM THIS, SAID PLAINLY ───────────────────────────────────────────────
 * The plan's B8 row says this viewer is "shared with C1". ⚠ **The read-only half is shared; the
 * signing half is not, and C1 should not open expecting it.** C1 needs a page rail, START/NEXT and
 * tap targets over 22 named places — and an `<iframe>` on a blob gives none of that: you cannot
 * address a page inside it, you cannot draw over it, and you cannot know which page the driver is
 * looking at. That needs canvas rendering, and the machinery is already in the repo and already
 * solved: `lib/pdfWords.ts` dynamically imports `pdfjs-dist` AND sets `GlobalWorkerOptions.workerSrc`
 * from the `?url` asset, which is the fiddly half. C1 builds on THAT, not on this iframe.
 */
const props = withDefaults(
  defineProps<{
    open: boolean;
    /** The requirement's human label — the modal title ("Medical examiner's certificate"). */
    label: string;
    /** A filed document: a row, signed URLs, a hash. */
    doc?: DocumentRow | null;
    /** A document the API renders on demand: a path to fetch, and no evidence to print. */
    rendered?: RenderedDocument | null;
  }>(),
  { doc: null, rendered: null },
);
const emit = defineEmits<{ close: [] }>();

const toast = useToastStore();
const isRendered = computed(() => props.rendered !== null);
const isPdf = computed(() => isRendered.value || props.doc?.contentType === "application/pdf");
/** normalized when the derive job has run; the signed original until then. */
const viewUrl = computed(() => props.doc?.normalizedUrl ?? props.doc?.url ?? null);

/** The blob this viewer fetched for a `rendered` document, and the frame's source while it is open. */
const objectUrl = ref<string | null>(null);
const loading = ref(false);
const loadError = ref<string | null>(null);

function release(): void {
  if (objectUrl.value === null) return;
  URL.revokeObjectURL(objectUrl.value);
  objectUrl.value = null;
}

/**
 * ⚠ A sequence number rather than a plain await, because reopening the modal on a second document
 * before the first has arrived would otherwise leave the slower response in the frame and leak the
 * faster one's URL. The superseded fetch revokes its own bytes and says nothing.
 */
let fetchSeq = 0;
watch(
  () => [props.open, props.rendered?.path] as const,
  async ([open, path]) => {
    release();
    loadError.value = null;
    if (!open || path === undefined) return;
    const seq = ++fetchSeq;
    loading.value = true;
    try {
      const url = await fetchObjectUrl(path);
      if (seq !== fetchSeq) return URL.revokeObjectURL(url);
      objectUrl.value = url;
    } catch (e) {
      if (seq !== fetchSeq) return;
      loadError.value = e instanceof Error ? e.message : "That document could not be opened.";
    } finally {
      if (seq === fetchSeq) loading.value = false;
    }
  },
  { immediate: true },
);

onBeforeUnmount(release);

const downloading = ref(false);
async function download(): Promise<void> {
  downloading.value = true;
  try {
    if (props.rendered) {
      // The bytes already on screen, not a second render of a document composed fresh each time.
      if (objectUrl.value === null) throw new Error("It has not finished loading yet.");
      saveObjectUrl(objectUrl.value, props.rendered.filename);
    } else if (props.doc) {
      const res = await apiFetch<{ url: string; filename: string }>(
        `/api/compliance/documents/${props.doc.id}/download`,
      );
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not sign the download.");
      // Content-Disposition: attachment is on the URL itself (server-side, B6) — a plain navigation
      // downloads in every browser with no fetch and no blob in memory.
      window.location.assign(res.data.url);
    }
  } catch (e) {
    toast.error("Could not download the document", e instanceof Error ? e.message : undefined);
  }
  downloading.value = false;
}

function print(): void {
  window.print();
}

const sizeLabel = computed(() => {
  const b = props.doc?.bytes;
  if (b == null) return null;
  if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
});
</script>

<template>
  <BaseModal :open="open" :title="label" size="xl" printable @close="emit('close')">
    <!-- A document with no row: the frame is the blob this viewer fetched, and there is no hash. -->
    <div v-if="rendered" class="space-y-4">
      <!-- ⚠ Not `h-[70vh]` like the filed branch above: this one carries a caption UNDER it, and
           70vh plus the caption plus BaseModal's own header, footer and padding overflows the
           panel's `max-h-[90vh]` — measured at 1440×900, where it hid the sentence saying this is
           not a stored copy behind the footer. Sized to what the panel actually leaves instead. -->
      <iframe
        v-if="objectUrl"
        :src="objectUrl"
        class="h-[calc(90vh-16rem)] min-h-80 w-full rounded-surface ring-1 ring-edge"
        :title="`${label} document`"
      />
      <p v-else-if="loading" class="py-10 text-center text-sm text-ink-muted">
        Preparing the document…
      </p>
      <p v-else class="py-10 text-center text-sm text-ink-muted">
        {{ loadError ?? "That document could not be opened." }}
      </p>

      <p class="text-xs text-ink-muted">
        Rendered from the answers on file as they are now. It is not a stored copy, so it carries no
        file hash.
      </p>
    </div>

    <div v-else-if="doc" class="space-y-4">
      <iframe
        v-if="isPdf && doc.url"
        :src="doc.url"
        class="h-[70vh] w-full rounded-surface ring-1 ring-edge"
        :title="`${label} document`"
      />
      <img
        v-else-if="viewUrl"
        :src="viewUrl"
        alt=""
        class="mx-auto max-h-[70vh] max-w-full rounded-surface object-contain ring-1 ring-edge"
      />
      <p v-else class="py-10 text-center text-sm text-ink-muted">
        The scan could not be loaded. Its signed link may have expired — close and reopen the file.
      </p>

      <!-- §390.32(c) made visible: the hash is what says these bytes are the registered bytes. -->
      <p class="text-xs text-ink-muted">
        <span class="capitalize">{{ doc.kind.replace(/_/g, " ") }}</span>
        <template v-if="doc.capturedAt"> · captured {{ formatDate(doc.capturedAt) }}</template>
        <template v-if="sizeLabel"> · {{ sizeLabel }}</template>
        · <span class="font-mono">{{ doc.sha256.slice(0, 12) }}</span>
      </p>
    </div>

    <template #footer>
      <div class="flex items-center justify-end gap-3">
        <BaseButton v-if="!isPdf" variant="ghost" @click="print">
          <AppIcon :icon="PrinterIcon" class="size-4" aria-hidden="true" />
          Print
        </BaseButton>
        <BaseButton :disabled="downloading || (isRendered && !objectUrl)" @click="download">
          <AppIcon :icon="ArrowDownTrayIcon" class="size-4" aria-hidden="true" />
          {{ downloading ? "Preparing…" : isRendered ? "Download a copy" : "Download original" }}
        </BaseButton>
        <BaseButton variant="primary" @click="emit('close')">Close</BaseButton>
      </div>
    </template>
  </BaseModal>
</template>
