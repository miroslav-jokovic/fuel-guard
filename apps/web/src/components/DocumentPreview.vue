<script setup lang="ts">
import { computed, ref } from "vue";
import type { DocumentRow } from "@silvicom/shared";
import { AppIcon, AppButton as BaseButton } from "@silvicom/ui";
import { ArrowDownTrayIcon, PrinterIcon } from "@silvicom/ui/icons";
import BaseModal from "@/components/ui/BaseModal.vue";
import { apiFetch } from "@/lib/api";
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
 */
const props = defineProps<{
  open: boolean;
  /** The requirement's human label — the modal title ("Medical examiner's certificate"). */
  label: string;
  doc: DocumentRow | null;
}>();
const emit = defineEmits<{ close: [] }>();

const toast = useToastStore();
const isPdf = computed(() => props.doc?.contentType === "application/pdf");
/** normalized when the derive job has run; the signed original until then. */
const viewUrl = computed(() => props.doc?.normalizedUrl ?? props.doc?.url ?? null);

const downloading = ref(false);
async function download(): Promise<void> {
  if (!props.doc) return;
  downloading.value = true;
  try {
    const res = await apiFetch<{ url: string; filename: string }>(
      `/api/compliance/documents/${props.doc.id}/download`,
    );
    if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not sign the download.");
    // Content-Disposition: attachment is on the URL itself (server-side, B6) — a plain navigation
    // downloads in every browser with no fetch and no blob in memory.
    window.location.assign(res.data.url);
  } catch (e) {
    toast.error("Could not download the original", e instanceof Error ? e.message : undefined);
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
    <div v-if="doc" class="space-y-4">
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
        <BaseButton :disabled="downloading" @click="download">
          <AppIcon :icon="ArrowDownTrayIcon" class="size-4" aria-hidden="true" />
          {{ downloading ? "Preparing…" : "Download original" }}
        </BaseButton>
        <BaseButton variant="primary" @click="emit('close')">Close</BaseButton>
      </div>
    </template>
  </BaseModal>
</template>
