<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { AppButton as BaseButton, AppCombobox as ComboSelect, AppFormField as FormField } from "@silvicom/ui";
import { DOCUMENT_CONTENT_TYPES, acceptFor, type RoadsideInspectionDto, type RoadsideInspectionWorkDto } from "@silvicom/shared";
import SlideOver from "@/components/SlideOver.vue";
import FileDropzone from "@/components/ui/FileDropzone.vue";
import { useToastStore } from "@/stores/toast";
import { formatDate } from "@/lib/format";
import { matchReportFile } from "./reportFileMatch";
import { useUploadReportTo } from "./useRoadsideInspections";

/**
 * Officer's reports, many at once, from the inbox (INSPECTION-CHALLENGE-PLAN IC15, owner 2026-10-19).
 *
 * The office keeps the paper in a pile; this files the pile. Each file is proposed an inspection from its
 * name (`matchReportFile`, a whole word only), a person confirms or chooses, and each is filed through the
 * same upload the Documents card uses — so the reading, the licence check and the driver's confirmation
 * (IC10) follow as for any report. Nothing is filed until "File" is pressed, and a file left without an
 * inspection is skipped, not guessed.
 *
 * The choice lists the inspections still waiting for their report first (`awaitsReport`, the Next steps
 * rule), newest first, then the rest.
 */

const props = defineProps<{
  open: boolean;
  inspections: readonly RoadsideInspectionDto[];
  work: ReadonlyMap<string, RoadsideInspectionWorkDto>;
}>();
const emit = defineEmits<{ close: [] }>();

const toast = useToastStore();
const upload = useUploadReportTo();

interface Pending {
  key: string;
  file: File;
  inspectionId: string;
  /** Proposed from the name, so the row can say so. */
  matched: boolean;
  state: "ready" | "filing" | "filed" | "failed";
  error: string | null;
}
const pending = ref<Pending[]>([]);
watch(
  () => props.open,
  (o) => {
    if (o) pending.value = [];
  },
);

function add(files: File[]) {
  for (const file of files) {
    const id = matchReportFile(file.name, props.inspections) ?? "";
    pending.value.push({ key: `${file.name}:${file.size}:${file.lastModified}:${pending.value.length}`, file, inspectionId: id, matched: !!id, state: "ready", error: null });
  }
}

const label = (i: RoadsideInspectionDto) =>
  [i.reportNumber ?? "No report number", i.inspectionDate ? formatDate(i.inspectionDate) : null, i.reportState].filter(Boolean).join(" · ");
const options = computed(() => {
  const awaits = (i: RoadsideInspectionDto) => (props.work.get(i.id)?.awaitsReport ? 0 : 1);
  return [...props.inspections]
    .sort((a, b) => awaits(a) - awaits(b) || (b.inspectionDate ?? "").localeCompare(a.inspectionDate ?? ""))
    .map((i) => ({ value: i.id, label: props.work.get(i.id)?.awaitsReport ? `${label(i)} — waiting for its report` : label(i) }));
});

const ready = computed(() => pending.value.filter((p) => p.state !== "filed" && p.inspectionId));
const busy = computed(() => pending.value.some((p) => p.state === "filing"));

/** One at a time: the uploads share the browser's connection, and a failure is said on its own row. */
async function fileAll() {
  let filed = 0;
  for (const p of ready.value) {
    p.state = "filing";
    p.error = null;
    try {
      await upload.mutateAsync({ inspectionId: p.inspectionId, file: p.file });
      p.state = "filed";
      filed++;
    } catch (e) {
      p.state = "failed";
      p.error = e instanceof Error ? e.message : "The report could not be filed.";
    }
  }
  if (filed) toast.success(`${filed} ${filed === 1 ? "report" : "reports"} filed`, "Each is read within the hour; the driver card says what it found.");
}
const remove = (key: string) => (pending.value = pending.value.filter((p) => p.key !== key));
</script>

<template>
  <SlideOver
    :open="open"
    title="Upload officer's reports"
    description="Drop the inspection reports. Each is matched to its inspection by the report number in its file name; choose the inspection for any that are not."
    size="lg"
    @close="emit('close')"
  >
    <div class="space-y-5">
      <FileDropzone
        multiple
        :accept="acceptFor(DOCUMENT_CONTENT_TYPES)"
        :busy="busy"
        busy-label="Filing…"
        label="Drag & drop the officer's reports here"
        hint="PDF or photo, as many as you have."
        @files="add"
      />

      <ul v-if="pending.length" class="divide-y divide-edge text-sm" data-test="bulk-files">
        <li v-for="p in pending" :key="p.key" class="space-y-2 py-3" data-test="bulk-file" :data-state="p.state">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <p class="min-w-0 truncate font-medium text-ink">{{ p.file.name }}</p>
            <span v-if="p.state === 'filed'" class="text-success-700" data-test="bulk-filed">Filed</span>
            <span v-else-if="p.state === 'filing'" class="text-ink-muted">Filing…</span>
            <BaseButton v-else variant="link" @click="remove(p.key)">Remove</BaseButton>
          </div>
          <FormField v-if="p.state !== 'filed'" v-slot="{ id }" label="Inspection" :hint="p.matched ? 'Matched by the report number in the file name.' : undefined">
            <ComboSelect :id="id" v-model="p.inspectionId" :options="options" placeholder="Choose the inspection…" :disabled="p.state === 'filing'" />
          </FormField>
          <p v-if="p.error" class="text-danger-700" role="alert">{{ p.error }}</p>
        </li>
      </ul>
    </div>

    <template #footer>
      <div class="flex items-center justify-between gap-3">
        <p class="text-xs text-ink-muted" data-test="bulk-summary">
          <template v-if="pending.length">{{ ready.length }} of {{ pending.filter((p) => p.state !== "filed").length }} ready to file</template>
        </p>
        <div class="flex gap-2">
          <BaseButton @click="emit('close')">Close</BaseButton>
          <BaseButton variant="primary" :disabled="!ready.length || busy" data-test="bulk-file-all" @click="fileAll">
            {{ ready.length ? `File ${ready.length} ${ready.length === 1 ? "report" : "reports"}` : "File" }}
          </BaseButton>
        </div>
      </div>
    </template>
  </SlideOver>
</template>
