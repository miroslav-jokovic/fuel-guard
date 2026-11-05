<script setup lang="ts">
import { computed, ref } from "vue";
import { AppIcon, AppButton as BaseButton } from "@silvicom/ui";
import { ArrowDownTrayIcon, ClipboardDocumentListIcon, DocumentTextIcon } from "@silvicom/ui/icons";
import { DQ_KIND_LABELS, FILE_CHIP_LABELS, type PaperThumb } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useToastStore } from "@/stores/toast";

/**
 * A unit's or a driver's papers in one table cell (UNIT-FILES-PLAN UF4, D-UF7): up to three
 * thumbnails, newest first by the paper's own date, and "+N". One component for the three lists — it
 * reads one row shape and knows nothing about trucks or people.
 *
 * ── NO STATE CHIP SINCE 2026-10-21 (Q-UF11) ─────────────────────────────────────────────────────
 * The cell opened with `fileChip`'s words as a button that set the list's `?file=` filter. After the
 * McLeod import it said "2 missing" on all 212 trucks with papers (IFTA and insurance, filed on the
 * organization or not at all) — the same words on every row, beside thumbnails that contradicted them
 * (Q-UF13). The owner asked for it gone. The FILTER stays: the toolbar's File control reads `fileChip`
 * in shared, not this cell, and the unit's own page still shows each item's state.
 *
 * Thumbnails are the 320 px derivatives (UF3) signed for five minutes; a paper with none yet — the
 * derive job has not run, or HEIC — is a type icon, never the 25 MB original. Each thumb is one tab
 * stop; hover or focus shows what it is, and Enter or a click opens the gallery on it.
 *
 * A drop on the cell emits `drop` with the files, and the page opens its `FileUploadDialog` with the
 * first one (DQ-FILE-COLUMN, 2026-11-03), where the drop card asks what it proves. Until then the page
 * navigated to the unit's File section (UF5b) and the reader dropped the same scan again, because a
 * navigation cannot carry a `File`. The cell itself still knows nothing about what a drop leads to.
 */
const props = defineProps<{
  papers: PaperThumb[];
  /** Every original on file — what "+N" counts past `papers`. */
  paperCount: number;
  /**
   * The file's items, to say which requirement a paper proves and until when — a truck's
   * `UnitFileCell`s or a driver's `DqRosterCell`s (UF4b), of which only these two fields are read.
   */
  items: ReadonlyArray<{ documentId: string | null; goodUntil: string | null }>;
  /** "Unit 654" — for the accessible names. */
  subjectLabel: string;
  /**
   * What the file still needs (DQ-INTO-DRIVERS-PLAN DD1, D-DQ22) — a driver's `attention` items. When
   * set and not empty, the cell ends in one control whose hover card lists them and whose click is the
   * page's to answer. Only Drivers passes it: a truck's outstanding items are mostly the organization's
   * insurance and IFTA, the same two words on every row, which is what Q-UF11 took out of this cell.
   *
   * A control and not just a line on the thumbnails' cards, because on 2026-11-05 no driver had a
   * scanned paper (183 of 183), so the cell had no thumbnail to hover and showed nothing at all.
   */
  outstanding?: ReadonlyArray<{ key: string; label: string; state: string; goodUntil: string | null }>;
}>();
const emit = defineEmits<{
  /** Open the gallery: on this paper, or with no id for "+N" — the first paper this cell did not draw. */
  open: [documentId?: string];
  /** Files were dropped on the cell: the page opens its upload dialog with them. */
  drop: [files: File[]];
  /** The outstanding control was clicked: the page decides where that leads for this reader. */
  outstanding: [];
}>();

const toast = useToastStore();
// A counter, as `FileDropzone` keeps one: dragenter/leave fire for every child the cursor crosses.
const dragging = ref(0);
function onDrop(e: DragEvent): void {
  dragging.value = 0;
  const files = Array.from(e.dataTransfer?.files ?? []);
  if (files.length) emit("drop", files);
}
/** "Expired", "Missing", "Expiring" — the File filter's own words for an item's state, not a second list. */
const stateWord = (state: string) => FILE_CHIP_LABELS[state as keyof typeof FILE_CHIP_LABELS] ?? state;
/** "Expired 01/01/2026", or the word alone when the item has no date ("Missing"). */
const itemStatus = (o: { state: string; goodUntil: string | null }) =>
  o.goodUntil ? `${stateWord(o.state)} ${formatDate(o.goodUntil)}` : stateWord(o.state);
const more = computed(() => Math.max(0, props.paperCount - props.papers.length));
const label = (kind: string) => DQ_KIND_LABELS[kind] ?? (kind === "other" ? "Other paper" : kind);
/** The requirement this paper is the evidence for, if any — its good-until is the date that matters. */
const provesOf = (documentId: string) => props.items.find((i) => i.documentId === documentId) ?? null;

async function download(documentId: string): Promise<void> {
  const res = await apiFetch<{ url: string }>(`/api/compliance/documents/${documentId}/download`);
  if (!res.ok || !res.data) {
    toast.error("Could not download the document", res.error?.message);
    return;
  }
  window.location.assign(res.data.url);
}
</script>

<template>
  <!-- Drag events augment the thumb buttons, as on `FileDropzone`; the container is not a control. -->
  <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions -->
  <div
    :class="['flex items-center gap-2 rounded-control transition-colors', dragging > 0 ? 'bg-brand-50/50 ring-2 ring-brand-400' : '']"
    data-test="file-cell"
    @dragenter.prevent="dragging++"
    @dragover.prevent
    @dragleave.prevent="dragging = Math.max(0, dragging - 1)"
    @drop.prevent="onDrop"
  >
    <div v-for="p in props.papers" :key="p.documentId" class="group relative" data-test="file-thumb">
      <BaseButton
        variant="ghost"
        size="sm"
        class="size-8 overflow-hidden rounded-detail p-0 ring-1 ring-edge"
        :aria-label="`Open ${label(p.kind)} for ${props.subjectLabel}`"
        @click="emit('open', p.documentId)"
      >
        <img v-if="p.thumbUrl" :src="p.thumbUrl" alt="" class="size-full object-cover" loading="lazy" />
        <AppIcon v-else :icon="DocumentTextIcon" class="size-4 text-ink-tertiary" aria-hidden="true" />
      </BaseButton>
      <!-- The hover card: what the paper is and until when. Shown on focus too, so a keyboard reader
           gets it without a pointer. -->
      <div
        role="tooltip"
        class="invisible absolute left-0 top-full z-popover mt-1 w-56 rounded-surface bg-surface p-3 text-xs shadow-overlay ring-1 ring-edge group-focus-within:visible group-hover:visible"
      >
        <p class="font-medium text-ink">{{ label(p.kind) }}</p>
        <p v-if="provesOf(p.documentId)?.goodUntil" class="text-ink-muted">
          Good until {{ formatDate(provesOf(p.documentId)!.goodUntil!) }}
        </p>
        <!-- The paper's own date (Q-UF10). "Filed … by" only when a person filed it here: an imported
             McLeod paper's filing date is the import run, which says nothing about the paper. -->
        <p class="text-ink-muted">Dated {{ formatDate(p.datedAt) }}</p>
        <p v-if="p.uploadedBy" class="text-ink-muted">Filed {{ formatDate(p.filedAt) }} by {{ p.uploadedBy }}</p>
        <BaseButton size="sm" variant="ghost" class="mt-2 -ml-2" @click="download(p.documentId)">
          <AppIcon :icon="ArrowDownTrayIcon" class="size-4" aria-hidden="true" /> Download
        </BaseButton>
      </div>
    </div>

    <BaseButton
      v-if="more > 0"
      variant="ghost"
      size="sm"
      class="tabular-nums text-ink-muted"
      :aria-label="`Open all ${props.paperCount} papers for ${props.subjectLabel}`"
      data-test="file-more"
      @click="emit('open')"
    >+{{ more }}</BaseButton>

    <div v-if="props.outstanding?.length" class="group relative" data-test="file-outstanding">
      <BaseButton
        variant="ghost"
        size="sm"
        class="text-ink-muted"
        :aria-label="`${props.outstanding.length} outstanding on ${props.subjectLabel}'s file`"
        @click="emit('outstanding')"
      >
        <AppIcon :icon="ClipboardDocumentListIcon" class="size-4" aria-hidden="true" />
      </BaseButton>
      <!-- Opens LEFTWARD from the control's right edge: the control ends the cell, File is often the
           last column on screen, and the table's horizontal scroller clips anything past its edge. -->
      <div
        role="tooltip"
        class="invisible absolute right-0 top-full z-popover mt-1 w-72 whitespace-normal rounded-surface bg-surface p-3 text-xs shadow-overlay ring-1 ring-edge group-focus-within:visible group-hover:visible"
      >
        <p class="font-medium text-ink">Still needed</p>
        <ul class="mt-1 space-y-1">
          <li v-for="o in props.outstanding" :key="o.key" class="text-ink-muted">
            <span class="text-ink">{{ o.label }}</span> · {{ itemStatus(o) }}
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>
