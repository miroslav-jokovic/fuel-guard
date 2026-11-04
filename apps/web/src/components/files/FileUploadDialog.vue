<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import { DQ_ITEMS, EQUIPMENT_ITEMS } from "@silvicom/shared";
import { AppButton as BaseButton, AppLinkArrow } from "@silvicom/ui";
import SlideOver from "@/components/SlideOver.vue";
import { BADGE_BASE, dqItemBadge, toneClass } from "@/lib/badges";
import type { DropItem, OutstandingItem } from "@/composables/useFileDropItems";
import { useOpens } from "@/composables/useOpens";
import DocumentDropCard from "./DocumentDropCard.vue";
import RequirementDrawer from "./RequirementDrawer.vue";
import type { FileSubject } from "./fileSubject";

/**
 * Add a paper to one subject's file without leaving the list (DQ-FILE-COLUMN) — the upload half of
 * the File column, beside `FileGallery`'s viewing half. One dialog per page, like the gallery.
 *
 * It is the file page's own drop-first flow (D-DQ10), not a second one: `DocumentDropCard` takes the
 * scan and asks what it proves, then `RequirementDrawer` opens with the scan attached and asks only
 * for the dates. Until 2026-11-03 a drop on a list cell navigated to the file page and the reader
 * dropped the same scan again there, because a navigation cannot carry a `File`.
 *
 * ⚠ D-ROS1 refused editing a requirement from a grid cell, because a cell does not know what else the
 * subject is missing. The owner relaxed it for this dialog on 2026-11-03, on the condition that answers
 * the objection: the dialog lists everything the file still needs beside the drop zone, and links to
 * the full file. A host that cannot say what is outstanding passes an empty list, and the link stays.
 *
 * One panel at any moment (design contract §6.2): the drop panel closes as the requirement drawer
 * opens, and closing the drawer closes the dialog.
 */
const props = defineProps<{
  /** Whose file; null closes the dialog. */
  subject: FileSubject | null;
  /** "Unit 654", "Jane Doe" — the panel's title. */
  subjectLabel: string;
  /** What a dropped scan can prove (`useDriverDropItems` / `useUnitDropItems`). */
  items: DropItem[];
  /** What the file still needs — listed so a decision made here is made with the whole file in view. */
  outstanding?: OutstandingItem[];
  /** A scan dropped on the list's cell, carried into the drop card. */
  initialFile?: File | null;
  /** The subject's full file page. */
  fileLink: string;
}>();
const emit = defineEmits<{ close: [] }>();

/** The catalogue the drawer looks a key up in: a driver's §391.51 items, or the equipment file's. */
const specs = computed(() => (props.subject?.type === "driver" ? DQ_ITEMS : EQUIPMENT_ITEMS));

const openKey = ref<string | null>(null);
const presetDoc = ref<{ id: string; name: string } | null>(null);
watch(
  () => props.subject?.id,
  () => {
    openKey.value = null;
    presetDoc.value = null;
  },
);
const dropOpen = computed(() => props.subject !== null && openKey.value === null);

/**
 * "Record" is offered only for an item this reader can file here — one of `items`, which already
 * leaves out restricted kinds the role cannot record (D-DQ15) and anything outside the subject's
 * catalogue. The rest stay listed, so the whole file is still in view, with no button the API refuses.
 */
const recordable = computed(() => new Set(props.items.map((i) => i.key)));
/** The full-file link is shown exactly when its page opens for this reader (SP5, `useOpens`). */
const opens = useOpens();

function onFiled(payload: { documentId: string; name: string; key: string }): void {
  presetDoc.value = { id: payload.documentId, name: payload.name };
  openKey.value = payload.key;
}
/** Record an outstanding item's dates with no new scan — the paper may already be on file. */
function record(key: string): void {
  presetDoc.value = null;
  openKey.value = key;
}
function closeDrawer(): void {
  openKey.value = null;
  presetDoc.value = null;
  emit("close");
}
</script>

<template>
  <SlideOver :open="dropOpen" size="lg" :title="`Add a paper — ${props.subjectLabel}`" @close="emit('close')">
    <div v-if="props.subject" class="space-y-6">
      <DocumentDropCard
        :key="props.subject.id"
        :subject="props.subject"
        :items="props.items"
        :initial-file="props.initialFile ?? null"
        @filed="onFiled"
      />

      <section v-if="props.outstanding?.length" aria-labelledby="upload-outstanding" data-test="upload-outstanding">
        <h3 id="upload-outstanding" class="text-sm font-semibold text-ink">Still needed on this file</h3>
        <ul class="mt-2 divide-y divide-edge">
          <li v-for="o in props.outstanding" :key="o.key" class="flex items-center gap-3 py-2 text-sm">
            <span :class="[BADGE_BASE, toneClass(dqItemBadge(o.state).tone), 'w-20 justify-center']">{{
              dqItemBadge(o.state).label
            }}</span>
            <span class="flex-1 text-ink">{{ o.label }}</span>
            <BaseButton v-if="recordable.has(o.key)" variant="ghost" size="sm" @click="record(o.key)">Record</BaseButton>
          </li>
        </ul>
      </section>

      <RouterLink v-if="opens(props.fileLink)" :to="props.fileLink" class="group inline-flex items-center gap-1 text-sm font-medium text-link hover:text-link-hover">
        Open the full file <AppLinkArrow />
      </RouterLink>
    </div>
  </SlideOver>

  <RequirementDrawer
    v-if="props.subject"
    :open="openKey !== null"
    :subject="props.subject"
    :specs="specs"
    :item-key="openKey"
    :preset-document="presetDoc"
    @close="closeDrawer"
  />
</template>
