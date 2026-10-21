<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { AppIcon, AppButton as BaseButton } from "@silvicom/ui";
import { ChevronLeftIcon, ChevronRightIcon, DocumentTextIcon } from "@silvicom/ui/icons";
import { DQ_KIND_LABELS, newestPaperFirst, paperDate, PAPERS_PER_ROW, type DocumentRow } from "@silvicom/shared";
import { formatDate } from "@/lib/format";
import DocumentPreview from "@/components/DocumentPreview.vue";
import { useDocumentsQuery } from "@/composables/useCompliance";
import type { FileSubject } from "./fileSubject";

/**
 * One subject's papers: every one as a thumbnail across the top, the chosen one full-size below,
 * ← / → between them (UNIT-FILES-PLAN UF4; the strip is Q-UF12, owner 2026-10-21).
 *
 * The strip is what makes it a gallery. Until 2026-10-21 this showed one paper and ‹ 1 of 6 ›, and
 * "+N" opened it on paper 1 — the thumbnail the cell had already drawn — so the papers "+N" counted
 * were three arrow presses away and nothing on screen said they existed. The owner read that as "not
 * everything appears". Every paper the reader may see is in the strip, newest first by the paper's own
 * date (`newestPaperFirst`, the cell's order), and a click opens it.
 *
 * It WRAPS the sanctioned viewer rather than forking it: `DocumentPreview` still draws, prints and
 * downloads the paper, and this component only decides which paper and puts ‹ 2 of 5 › in the slot the
 * viewer leaves for it. One dialog at any moment (design contract §6.2) — the print path hides
 * `body *` and shows one `.print-target`, and a second panel would print blank.
 *
 * The papers are fetched when the gallery opens, not with the list: a 244-truck roster does not sign
 * every original's URL on load, only the 320 px thumbnails it draws.
 *
 * ⚠ The plan's side list of items and "Replace with newer" live on the unit's own page (UF5), where
 * `RequirementDrawer` already sits with the unit's catalogue around it — not in a dialog opened from a
 * grid cell, which is the editing-out-of-context D-ROS1 refuses.
 */
const props = defineProps<{
  /** Whose papers; null closes the gallery. */
  subject: FileSubject | null;
  subjectLabel: string;
  /**
   * The paper to open on — a thumbnail the cell drew. Absent means the cell's "+N": open on the first
   * paper the cell did NOT draw, which is index `PAPERS_PER_ROW` because the cell draws the first three
   * of this same order. Fewer papers than that (one was filed since the list loaded) opens the newest.
   */
  startId?: string | null;
}>();
const emit = defineEmits<{ close: [] }>();

const subjectType = computed(() => props.subject?.type ?? "tractor");
const subjectId = computed(() => props.subject?.id ?? null);
const docsQ = useDocumentsQuery(subjectType, subjectId);

/** Newest first by the paper's own date, the cell's order (Q-UF10), so the cell's first thumb is the strip's first. */
const papers = computed<DocumentRow[]>(() => [...(docsQ.data.value ?? [])].sort(newestPaperFirst));
const index = ref(0);
watch(
  [papers, () => props.startId, () => props.subject],
  () => {
    const at = props.startId
      ? papers.value.findIndex((d) => d.id === props.startId)
      : papers.value.length > PAPERS_PER_ROW ? PAPERS_PER_ROW : 0;
    index.value = Math.max(0, at);
  },
  { immediate: true },
);
const current = computed(() => papers.value[index.value] ?? null);
const label = (d: DocumentRow) => DQ_KIND_LABELS[d.kind] ?? (d.kind === "other" ? "Other paper" : d.kind);

const step = (by: number) => {
  if (!papers.value.length) return;
  index.value = (index.value + by + papers.value.length) % papers.value.length;
};
function onKey(e: KeyboardEvent): void {
  if (e.key === "ArrowLeft") step(-1);
  else if (e.key === "ArrowRight") step(1);
}
watch(
  () => props.subject !== null,
  (open) => (open ? window.addEventListener("keydown", onKey) : window.removeEventListener("keydown", onKey)),
  { immediate: true },
);
onBeforeUnmount(() => window.removeEventListener("keydown", onKey));
</script>

<template>
  <DocumentPreview
    :open="props.subject !== null && current !== null"
    :label="current ? `${props.subjectLabel} — ${label(current)}` : ''"
    :doc="current"
    @close="emit('close')"
  >
    <template v-if="papers.length > 1" #strip>
      <ul class="flex gap-2 overflow-x-auto pb-1" :aria-label="`Papers on file for ${props.subjectLabel}`" data-test="gallery-strip">
        <li v-for="(d, i) in papers" :key="d.id" class="shrink-0">
          <BaseButton
            variant="ghost"
            size="thumb"
            :class="['overflow-hidden', i === index ? 'ring-2 ring-brand-500' : 'ring-1 ring-edge']"
            :aria-label="`${label(d)}, dated ${formatDate(paperDate(d))}`"
            :aria-current="i === index ? 'true' : undefined"
            :title="`${label(d)} · ${formatDate(paperDate(d))}`"
            data-test="gallery-thumb"
            @click="index = i"
          >
            <img v-if="d.thumbUrl" :src="d.thumbUrl" alt="" class="size-full object-cover" loading="lazy" />
            <AppIcon v-else :icon="DocumentTextIcon" class="size-5 text-ink-tertiary" aria-hidden="true" />
          </BaseButton>
        </li>
      </ul>
    </template>
    <template v-if="papers.length > 1" #nav>
      <BaseButton size="sm" variant="ghost" aria-label="Previous paper" @click="step(-1)">
        <AppIcon :icon="ChevronLeftIcon" class="size-4" aria-hidden="true" />
      </BaseButton>
      <span class="text-xs tabular-nums text-ink-muted" data-test="gallery-position">{{ index + 1 }} of {{ papers.length }}</span>
      <BaseButton size="sm" variant="ghost" aria-label="Next paper" @click="step(1)">
        <AppIcon :icon="ChevronRightIcon" class="size-4" aria-hidden="true" />
      </BaseButton>
    </template>
  </DocumentPreview>
</template>
