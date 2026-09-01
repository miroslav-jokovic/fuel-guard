<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import {
  AppButton as BaseButton,
  AppCallout,
  AppFormField as FormField,
  AppInput as BaseInput,
  AppSelect,
} from "@silvicom/ui";
import { fetchObjectUrl } from "@/lib/api";
import { usePrintProfilesQuery, useSavePrintProfile } from "@/features/maintenance/useAnnualInspections";

/**
 * Choosing how this inspection goes onto paper — a drawer body (D-AVI8).
 *
 * Two kinds of paper and they are genuinely different documents. Plain paper gets the whole form,
 * artwork and values together, which is also the copy that gets filed. A pre-printed pad gets the
 * VALUES ONLY, positioned to land inside boxes somebody else printed — which is where registration
 * starts to matter and why a printer setup exists at all.
 *
 * Setup lives here rather than on a settings page because this is the moment somebody discovers
 * they need it: nobody goes looking for a calibration screen, they find a page printed two
 * millimetres low.
 */

const props = defineProps<{ inspectionId: string; canManage: boolean }>();
const emit = defineEmits<{ cancel: [] }>();

const profiles = usePrintProfilesQuery();
const saveProfile = useSavePrintProfile();

const target = ref<"plain" | "preprinted">("plain");
const profileId = ref("");
const failure = ref<string | null>(null);
const setupOpen = ref(false);

const profileOptions = computed(() => (profiles.data.value ?? []).map((p) => ({ value: p.id, label: p.name })));
const needsProfile = computed(() => target.value === "preprinted" && !profileId.value);
const editing = computed(() => (profiles.data.value ?? []).find((p) => p.id === profileId.value) ?? null);

const form = reactive({ name: "", offsetXPt: 0, offsetYPt: 0 });

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

const printAlignmentSheet = () =>
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
  <div class="space-y-6">
    <section v-if="!setupOpen" aria-labelledby="print-target">
      <h3 id="print-target" class="text-sm font-semibold text-ink">Paper</h3>
      <p class="mt-1 text-sm text-ink-muted">
        Plain paper carries the whole form. A pre-printed pad gets the values only, so they have to
        land inside boxes the pad already has.
      </p>
      <div class="mt-4 space-y-4">
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
        <FormField
          v-if="target === 'preprinted'"
          v-slot="{ id }"
          label="Printer"
          hint="Alignment belongs to the printer, so each one is measured once."
        >
          <AppSelect :id="id" v-model="profileId" :options="profileOptions" placeholder="Choose a printer" />
        </FormField>
      </div>

      <AppCallout v-if="needsProfile" tone="caution" class="mt-4">
        Pick the printer this is going to, or set one up — values printed without an alignment land
        wherever the printer happens to put them.
      </AppCallout>

      <div v-if="target === 'preprinted'" class="mt-4 flex flex-wrap gap-2">
        <BaseButton v-if="canManage" size="sm" variant="secondary" @click="openSetup">
          {{ editing ? "Adjust this printer" : "Set up a printer" }}
        </BaseButton>
        <BaseButton size="sm" variant="ghost" @click="printAlignmentSheet">Print alignment sheet</BaseButton>
      </div>
    </section>

    <section v-else aria-labelledby="print-setup">
      <h3 id="print-setup" class="text-sm font-semibold text-ink">Printer setup</h3>
      <p class="mt-1 text-sm text-ink-muted">
        Print the alignment sheet, lay it over a blank form, and measure how far each crosshair sits
        from the middle of the box it names. Right and down are positive. 1 mm = 2.83 points.
      </p>
      <div class="mt-4 space-y-4">
        <FormField v-slot="{ id }" label="Printer name">
          <BaseInput :id="id" v-model="form.name" placeholder="e.g. Shop laser" />
        </FormField>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField v-slot="{ id }" label="Across (points)">
            <BaseInput :id="id" v-model.number="form.offsetXPt" type="number" step="0.25" />
          </FormField>
          <FormField v-slot="{ id }" label="Down (points)">
            <BaseInput :id="id" v-model.number="form.offsetYPt" type="number" step="0.25" />
          </FormField>
        </div>
      </div>
    </section>

    <AppCallout v-if="failure" tone="danger">{{ failure }}</AppCallout>

    <div class="flex justify-end gap-2">
      <template v-if="setupOpen">
        <BaseButton variant="secondary" @click="setupOpen = false">Back</BaseButton>
        <BaseButton variant="primary" :disabled="!form.name.trim() || saveProfile.isPending.value" @click="saveSetup">
          Save printer
        </BaseButton>
      </template>
      <template v-else>
        <BaseButton variant="secondary" @click="emit('cancel')">Cancel</BaseButton>
        <BaseButton variant="primary" :disabled="needsProfile" @click="printIt">Print</BaseButton>
      </template>
    </div>
  </div>
</template>
