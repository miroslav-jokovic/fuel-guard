<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { AppIcon, AppButton as BaseButton } from "@silvicom/ui";
import { DocumentTextIcon } from "@silvicom/ui/icons";
import type { DocumentRow } from "@silvicom/shared";
import { DQ_KIND_LABELS } from "@silvicom/shared";
import BaseModal from "@/components/ui/BaseModal.vue";
import DocumentPreview from "@/components/DocumentPreview.vue";
import { formatDate } from "@/lib/format";

/**
 * Every scan filed for one subject — the "DQF folder" the roster ask asked for (R5b, D-ROS8).
 *
 * ── NEVER TWO DIALOGS, AND WHY THAT IS NOT MERELY A STYLE RULE ──────────────────────────────────
 * Design contract §6.2 forbids stacked modals, and here the cost is concrete: printing a scan works
 * by hiding `body *` and revealing a single `.print-target` panel (style.css), which is the only
 * cross-origin-safe way to print a signed-URL image. That is the product's actual job during a DOT
 * visit, so it is not something to be clever near.
 *
 * This modal therefore SWAPS rather than stacks: choosing a scan closes the list and opens the
 * sanctioned viewer; closing the viewer returns to the list. Exactly one dialog exists at any
 * moment, and `DocumentPreview` is used completely unmodified — the print path is not re-implemented
 * or wrapped, which is the only way to be sure it still works.
 *
 * ── WHY IT IS SUBJECT-SHAPED RATHER THAN DRIVER-SHAPED ──────────────────────────────────────────
 * `documents.subject_type` already accepts `tractor` and `trailer` (`complianceContract.ts`), and
 * D-ROS10 says the equipment rosters reuse this shape. Nothing here knows what a driver is.
 */
const props = defineProps<{
  open: boolean;
  /** Whose folder this is — the modal's title ("Marcus Reyes"). */
  subjectLabel: string;
  documents: DocumentRow[];
  loading: boolean;
  error: string | null;
}>();
const emit = defineEmits<{ close: [] }>();

/** Which scan is being viewed. Null means the list is the thing on screen. */
const openDocId = ref<string | null>(null);
const openDoc = computed(() => props.documents.find((d) => d.id === openDocId.value) ?? null);

// A folder closed while a scan is open must not reopen onto that scan next time.
watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) openDocId.value = null;
  },
);

/**
 * The requirement's own words where the catalogue has them, the raw kind otherwise.
 *
 * `DQ_KIND_LABELS` is the same vocabulary the qualification file uses, so a scan is called the same
 * thing in the folder as on the driver's page — the rule that no `.vue` file carries its own status
 * or kind vocabulary applies to document kinds too.
 */
const labelFor = (doc: DocumentRow): string => DQ_KIND_LABELS[doc.kind] ?? doc.kind;

/** Newest first: the reason somebody opens this is usually the thing that just arrived. */
const ordered = computed(() =>
  [...props.documents].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
);
</script>

<template>
  <!-- The list. Absent from the DOM entirely while a scan is open, so there is never a second panel
       for the print rules to have an opinion about. -->
  <BaseModal
    :open="props.open && !openDoc"
    :title="props.subjectLabel"
    description="Every scan filed for this driver's qualification file."
    size="lg"
    @close="emit('close')"
  >
    <p v-if="props.loading" class="text-sm text-ink-muted">Loading the folder…</p>
    <p v-else-if="props.error" class="text-sm text-danger-700">{{ props.error }}</p>
    <p v-else-if="!ordered.length" class="text-sm text-ink-muted">
      Nothing filed yet. Scans added on the driver's qualification page appear here.
    </p>
    <ul v-else class="divide-y divide-edge-subtle">
      <li v-for="doc in ordered" :key="doc.id">
        <BaseButton
          variant="ghost"
          class="w-full justify-start gap-3 py-3 text-left"
          @click="openDocId = doc.id"
        >
          <AppIcon :icon="DocumentTextIcon" class="size-5 shrink-0 text-ink-tertiary" aria-hidden="true" />
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm font-medium text-ink">{{ labelFor(doc) }}</span>
            <span class="block text-xs text-ink-muted">
              Filed {{ formatDate(doc.createdAt) }}
              <template v-if="doc.page > 1">· page {{ doc.page }}</template>
            </span>
          </span>
        </BaseButton>
      </li>
    </ul>
  </BaseModal>

  <!-- The sanctioned viewer, unmodified. Closing it returns to the list rather than to the page,
       which is what makes the pair read as one surface without ever being two dialogs. -->
  <DocumentPreview
    :open="props.open && !!openDoc"
    :label="openDoc ? labelFor(openDoc) : ''"
    :doc="openDoc"
    @close="openDocId = null"
  />
</template>
