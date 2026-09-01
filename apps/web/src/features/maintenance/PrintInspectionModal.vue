<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import {
  AppButton as BaseButton,
  AppCallout,
  AppFormField as FormField,
  AppInput as BaseInput,
  AppSelect,
} from "@silvicom/ui";
import BaseModal from "@/components/ui/BaseModal.vue";
import { fetchObjectUrl } from "@/lib/api";
import { usePrintProfilesQuery, useSavePrintProfile } from "@/features/maintenance/useAnnualInspections";

/**
 * Choosing how this inspection goes onto paper (D-AVI8).
 *
 * Two kinds of paper and they are genuinely different documents. Plain paper gets the whole form —
 * artwork and values together, which is also the copy that gets filed. A pre-printed pad gets the
 * VALUES ONLY, positioned to land inside boxes somebody else printed, which is where registration
 * starts to matter and why a printer setup exists at all.
 *
 * Setup lives here rather than in a settings page because this is the moment somebody discovers
 * they need it — the office does not go looking for a calibration screen, it finds a page printed
 * two millimetres low.
 */

const props = defineProps<{ inspectionId: string; canManage: boolean }>();
const emit = defineEmits<{ close: [] }>();

const profiles = usePrintProfilesQuery();
const saveProfile = useSavePrintProfile();

const target = ref<"plain" | "preprinted">("plain");
const profileId = ref("");
const failure = ref<string | null>(null);
const setupOpen = ref(false);

const profileOptions = computed(() =>
  (profiles.data.value ?? []).map((p) => ({ value: p.id, label: p.name })),
);
const needsProfile = computed(() => target.value === "preprinted" && !profileId.value);

const form = reactive({ name: "", offsetXPt: 0, offsetYPt: 0 });
const editing = computed(() => (profiles.data.value ?? []).find((p) => p.id === profileId.value) ?? null);

function openSetup() {
  const current = editing.value;
  form.name = current?.name ?? "";
  form.offsetXPt = current?.offset_x_pt ?? 0;
  form.offsetYPt = current?.offset_y_pt ?? 0;
  setupOpen.value = true;
}

async function open(path: string) {
  failure.value = null;
  try {
    const url = await fetchObjectUrl(path);
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    failure.value = e instanceof Error ? e.message : "Could not open the document";
  }
}

const printIt = () =>
  open(
    target.value === "plain"
      ? `/api/maintenance/inspections/${props.inspectionId}/report.pdf`
      : `/api/maintenance/inspections/${props.inspectionId}/overlay.pdf?profile=${profileId.value}`,
  );

const printRegistrationSheet = () =>
  open(`/api/maintenance/printing/registration-sheet.pdf${profileId.value ? `?profile=${profileId.value}` : ""}`);

async function saveSetup() {
  failure.value = null;
  try {
    await saveProfile.mutateAsync({
      id: editing.value?.id,
      name: form.name.trim(),
      offsetXPt: Number(form.offsetXPt),
      offsetYPt: Number(form.offsetYPt),
    });
    setupOpen.value = false;
  } catch (e) {
    failure.value = e instanceof Error ? e.message : "Could not save the printer setup";
  }
}
</script>

<template>
  <BaseModal :open="true" :title="setupOpen ? 'Printer setup' : 'Print inspection'" @close="emit('close')">
    <div v-if="!setupOpen" class="space-y-4">
      <FormField v-slot="{ id }" label="Print onto">
        <AppSelect
          :id="id"
          v-model="target"
          :options="[
            { value: 'plain', label: 'Plain paper — the whole form' },
            { value: 'preprinted', label: 'Pre-printed inspection pad — values only' },
          ]"
        />
      </FormField>

      <template v-if="target === 'preprinted'">
        <FormField
          v-slot="{ id }"
          label="Printer"
          hint="Alignment is a property of the printer, so each one is measured once."
        >
          <AppSelect :id="id" v-model="profileId" :options="profileOptions" placeholder="Choose a printer" />
        </FormField>
        <AppCallout v-if="needsProfile" tone="caution">
          Pick the printer this is going to, or set one up — values printed without an alignment land
          wherever the printer happens to put them.
        </AppCallout>
        <div class="flex flex-wrap gap-2">
          <BaseButton v-if="canManage" size="sm" variant="secondary" @click="openSetup">
            {{ editing ? "Adjust this printer" : "Set up a printer" }}
          </BaseButton>
          <BaseButton size="sm" variant="ghost" @click="printRegistrationSheet">
            Print alignment sheet
          </BaseButton>
        </div>
      </template>

      <AppCallout v-if="failure" tone="danger">{{ failure }}</AppCallout>
    </div>

    <div v-else class="space-y-4">
      <p class="text-sm text-ink-secondary">
        Print the alignment sheet, lay it over a blank form, and measure how far each crosshair is
        from the middle of the box it names. Right and down are positive. 1 mm = 2.83 points.
      </p>
      <FormField v-slot="{ id }" label="Printer name">
        <BaseInput :id="id" v-model="form.name" placeholder="e.g. Shop laser" />
      </FormField>
      <div class="grid grid-cols-2 gap-4">
        <FormField v-slot="{ id }" label="Across (points)">
          <BaseInput :id="id" v-model.number="form.offsetXPt" type="number" step="0.25" />
        </FormField>
        <FormField v-slot="{ id }" label="Down (points)">
          <BaseInput :id="id" v-model.number="form.offsetYPt" type="number" step="0.25" />
        </FormField>
      </div>
      <AppCallout v-if="failure" tone="danger">{{ failure }}</AppCallout>
    </div>

    <template #footer>
      <template v-if="setupOpen">
        <BaseButton variant="secondary" @click="setupOpen = false">Back</BaseButton>
        <BaseButton
          variant="primary"
          :disabled="!form.name.trim() || saveProfile.isPending.value"
          @click="saveSetup"
        >
          Save printer
        </BaseButton>
      </template>
      <template v-else>
        <BaseButton variant="secondary" @click="emit('close')">Cancel</BaseButton>
        <BaseButton variant="primary" :disabled="needsProfile" @click="printIt">Print</BaseButton>
      </template>
    </template>
  </BaseModal>
</template>
