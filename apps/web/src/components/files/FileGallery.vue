<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { AppIcon, AppButton as BaseButton } from "@silvicom/ui";
import { ChevronLeftIcon, ChevronRightIcon } from "@silvicom/ui/icons";
import { DQ_KIND_LABELS, type DocumentRow } from "@silvicom/shared";
import DocumentPreview from "@/components/DocumentPreview.vue";
import { useDocumentsQuery } from "@/composables/useCompliance";
import type { FileSubject } from "./fileSubject";

/**
 * One subject's papers, one at a time, ← / → between them (UNIT-FILES-PLAN UF4).
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
  /** The paper to open on; the newest when absent. */
  startId?: string | null;
}>();
const emit = defineEmits<{ close: [] }>();

const subjectType = computed(() => props.subject?.type ?? "tractor");
const subjectId = computed(() => props.subject?.id ?? null);
const docsQ = useDocumentsQuery(subjectType, subjectId);

/** Newest first, like the cell's thumbnails, so the cell's first thumb is the gallery's first page. */
const papers = computed<DocumentRow[]>(() =>
  [...(docsQ.data.value ?? [])].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
);
const index = ref(0);
watch(
  [papers, () => props.startId, () => props.subject],
  () => {
    const at = props.startId ? papers.value.findIndex((d) => d.id === props.startId) : 0;
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
