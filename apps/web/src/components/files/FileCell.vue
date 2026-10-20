<script setup lang="ts">
import { computed, ref } from "vue";
import { AppIcon, AppButton as BaseButton } from "@silvicom/ui";
import { ArrowDownTrayIcon, DocumentTextIcon } from "@silvicom/ui/icons";
import { DQ_KIND_LABELS, type FileChip, type PaperThumb } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { BADGE_BASE, fileChipTone, toneClass } from "@/lib/badges";
import { formatDate } from "@/lib/format";
import { useToastStore } from "@/stores/toast";

/**
 * A unit's or a driver's file in one table cell (UNIT-FILES-PLAN UF4, D-UF7): the state chip, up to
 * three thumbnails, "+N". One component for the three lists — it reads one row shape and knows
 * nothing about trucks or people.
 *
 * The chip comes FIRST and is worked out by `fileChip` in shared — never here — because the same
 * function answers the page's `?file=` filter: clicking "2 expiring" lists exactly the rows whose chip
 * says expiring. The cell only draws it and says which filter it is.
 *
 * Thumbnails are the 320 px derivatives (UF3) signed for five minutes; a paper with none yet — the
 * derive job has not run, or HEIC — is a type icon, never the 25 MB original. Each thumb is one tab
 * stop; hover or focus shows what it is, and Enter or a click opens the gallery on it.
 *
 * A drop on the cell OPENS THE UNIT'S FILE SECTION (UF5b): the cell emits `drop` and the page goes to
 * `/vehicles/:id?section=file`, where the drop card files the paper against the right requirement.
 * The dropped bytes do not travel — a navigation cannot carry a `File` — so the reader drops again
 * there; the plan's bulk intake scoped to the subject (UF7) is what takes the bytes from here.
 */
const props = defineProps<{
  chip: FileChip;
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
}>();
const emit = defineEmits<{
  /** Open the gallery, on this paper when one was chosen. */
  open: [documentId?: string];
  /** The chip was clicked: narrow the list to files in this state. */
  filter: [kind: FileChip["kind"]];
  /** Files were dropped on the cell: open the unit's File section (UF5b). */
  drop: [files: File[]];
}>();

const toast = useToastStore();
// A counter, as `FileDropzone` keeps one: dragenter/leave fire for every child the cursor crosses.
const dragging = ref(0);
function onDrop(e: DragEvent): void {
  dragging.value = 0;
  const files = Array.from(e.dataTransfer?.files ?? []);
  if (files.length) emit("drop", files);
}
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
  <!-- Drag events augment the chip and thumb buttons, as on `FileDropzone`; the container is not a control. -->
  <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions -->
  <div
    :class="['flex items-center gap-2 rounded-control transition-colors', dragging > 0 ? 'bg-brand-50/50 ring-2 ring-brand-400' : '']"
    data-test="file-cell"
    @dragenter.prevent="dragging++"
    @dragover.prevent
    @dragleave.prevent="dragging = Math.max(0, dragging - 1)"
    @drop.prevent="onDrop"
  >
    <BaseButton
      variant="ghost"
      size="sm"
      :class="[BADGE_BASE, toneClass(fileChipTone(props.chip.kind)), 'whitespace-nowrap']"
      :title="`Show every file that reads “${props.chip.label}”`"
      data-test="file-chip"
      @click="emit('filter', props.chip.kind)"
    >{{ props.chip.label }}</BaseButton>

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
        <p class="text-ink-muted">Filed {{ formatDate(p.filedAt) }}<template v-if="p.uploadedBy"> by {{ p.uploadedBy }}</template></p>
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
  </div>
</template>
