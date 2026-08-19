<script setup lang="ts">
import { computed, ref } from "vue";
import { AppIcon } from "@fuelguard/ui";
import { ArrowUpTrayIcon } from "@fuelguard/ui/icons";
import { AppCard as BaseCard } from "@fuelguard/ui";
import { AppButton as BaseButton } from "@fuelguard/ui";
import { AppCombobox as ComboSelect } from "@fuelguard/ui";
import { AppFormField as FormField } from "@fuelguard/ui";
import FileDropzone from "@/components/ui/FileDropzone.vue";
import { useToastStore } from "@/stores/toast";
import { useUploadDocument } from "@/composables/useCompliance";

/**
 * Drop first, classify after (D-DQ10). The scan usually arrives before the data entry, so the card
 * takes the file, asks what it proves, uploads — and then hands off to the parent, because filing
 * the scan is HALF the job: the requirement only counts once its dates are recorded. The parent
 * opens the requirement drawer with the uploaded scan already attached.
 */
const props = defineProps<{
  driverId: string;
  /** The driver's requirements — what a dropped scan can prove. */
  items: Array<{ key: string; label: string; evidenceKind: string }>;
}>();
const emit = defineEmits<{ filed: [payload: { documentId: string; name: string; key: string }] }>();

const toast = useToastStore();
const upload = useUploadDocument();

const dropped = ref<File | null>(null);
const dropKind = ref("");
const dropOptions = computed(() => props.items.map((i) => ({ value: i.key, label: i.label })));

async function fileDropped(): Promise<void> {
  const chosen = dropped.value;
  const item = props.items.find((i) => i.key === dropKind.value);
  if (!chosen || !item) return;
  try {
    const res = await upload.mutateAsync({
      subjectType: "driver",
      subjectId: props.driverId,
      kind: item.evidenceKind as Parameters<typeof upload.mutateAsync>[0]["kind"],
      file: chosen,
    });
    toast.success("Document filed", `Now record the dates so the ${item.label.toLowerCase()} counts.`);
    emit("filed", { documentId: res.documentId, name: chosen.name, key: item.key });
    dropped.value = null;
    dropKind.value = "";
  } catch (e) {
    toast.error("Could not file the document", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <BaseCard>
    <h3 class="text-sm font-semibold text-ink">Drop a document</h3>
    <p class="mt-1 text-sm text-ink-muted">
      The scan usually arrives before the data entry. Drop it here and say what it proves.
    </p>
    <div class="mt-3 space-y-4">
      <FileDropzone
        accept=".pdf,.jpg,.jpeg,.png,.webp,.heic"
        :busy="upload.isPending.value"
        busy-label="Uploading…"
        :label="dropped ? dropped.name : 'Drag & drop a scan here'"
        hint="PDF or photo."
        @files="dropped = $event[0] ?? null"
      />
      <div v-if="dropped" class="flex flex-wrap items-end gap-3">
        <FormField v-slot="{ id }" label="What does it prove?" class="min-w-[16rem] flex-1">
          <ComboSelect
            :id="id"
            v-model="dropKind"
            :options="dropOptions"
            placeholder="Choose a requirement…"
          />
        </FormField>
        <BaseButton
          variant="primary"
          :disabled="!dropKind || upload.isPending.value"
          @click="fileDropped"
        >
          <AppIcon :icon="ArrowUpTrayIcon" class="size-4" aria-hidden="true" />
          {{ upload.isPending.value ? "Uploading…" : "File it" }}
        </BaseButton>
      </div>
    </div>
  </BaseCard>
</template>
