<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  AppButton as BaseButton,
  AppCallout,
  AppCombobox as ComboSelect,
  AppDateField,
  AppFormField as FormField,
} from "@silvicom/ui";
import type { InspectionSubjectType } from "@silvicom/shared";
import SlideOver from "@/components/SlideOver.vue";
import { useToastStore } from "@/stores/toast";
import { useVehiclesQuery } from "@/composables/useVehicles";
import { useTrailersQuery } from "@/composables/useTrailers";
import { useCreateInspection, useInspectorsQuery } from "@/features/maintenance/useAnnualInspections";

/**
 * Starting an inspection — a drawer that owns itself, per `apps/web/CLAUDE.md` and contract §6.2.
 *
 * Three questions and nothing else: which machine, who is inspecting it, on what date. Everything
 * else a report needs is seeded from the catalogue or derived, so asking here would be asking twice.
 *
 * ── ONE DROPDOWN CONTROL, NOT TWO ──────────────────────────────────────────────────────────────
 * Equipment type used to be an `AppSelect` sitting directly above two `ComboSelect`s, which is a
 * native operating-system menu beside a tokened popover in the same three-field form — the one place
 * in the product where you could see both at once. `apps/web/CLAUDE.md` splits the two by surface
 * (`FilterSelect` in toolbars, `ComboSelect` in forms) rather than by how many options there are, so
 * all three are the same control now.
 *
 * The remaining `AppCallout` is NOT mutation feedback — it is the state of the register, read before
 * anything is attempted. Failures go to a toast (§5.8).
 */

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ created: [id: string]; close: [] }>();

const toast = useToastStore();
const today = () => new Date().toISOString().slice(0, 10);

const subjectType = ref<InspectionSubjectType>("tractor");
const subjectId = ref("");
const inspectorId = ref("");
const inspectedOn = ref(today());

/** Reopening must not offer the last attempt's answers as though they were this one's. */
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    subjectType.value = "tractor";
    subjectId.value = "";
    inspectorId.value = "";
    inspectedOn.value = today();
  },
);

const vehicles = useVehiclesQuery();
const trailers = useTrailersQuery();
const inspectors = useInspectorsQuery();
const create = useCreateInspection();

const equipmentOptions = computed(() =>
  (subjectType.value === "tractor"
    ? (vehicles.data.value ?? []).map((v) => ({ id: v.id, unit: v.unit_number }))
    : (trailers.data.value ?? []).map((t) => ({ id: t.id, unit: t.unit_number }))
  ).map((r) => ({ value: r.id, label: r.unit })),
);

/**
 * Only people whose qualification covers the date being inspected. The report asserts they hold
 * one, so offering somebody who does not is offering a refusal the reader meets at the end.
 */
const inspectorOptions = computed(() =>
  (inspectors.data.value ?? []).filter((i) => i.qualified).map((i) => ({ value: i.id, label: i.full_name })),
);
const noInspectors = computed(() => inspectors.isFetched.value && inspectorOptions.value.length === 0);
const ready = computed(() => Boolean(subjectId.value && inspectorId.value && inspectedOn.value));
const saving = ref(false);

async function save() {
  if (!ready.value || saving.value) return;
  saving.value = true;
  try {
    const id = await create.mutateAsync({
      subjectType: subjectType.value,
      subjectId: subjectId.value,
      inspectorId: inspectorId.value,
      inspectedOn: inspectedOn.value,
    });
    toast.success("Inspection started");
    emit("created", id);
  } catch (e) {
    toast.error("Could not start the inspection", e instanceof Error ? e.message : undefined);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <SlideOver :open="open" size="lg" title="New inspection" @close="emit('close')">
    <form id="new-inspection-form" class="space-y-6" @submit.prevent="save">
      <AppCallout v-if="noInspectors" tone="caution">
        Nobody is on the inspector register yet. An inspection records who performed it, so add an
        inspector before starting one.
      </AppCallout>

      <section aria-labelledby="new-inspection-what">
        <h3 id="new-inspection-what" class="text-sm font-semibold text-ink">What is being inspected</h3>
        <div class="mt-4 space-y-4">
          <FormField v-slot="{ id }" label="Equipment type">
            <ComboSelect
              :id="id"
              v-model="subjectType"
              :options="[
                { value: 'tractor', label: 'Tractor' },
                { value: 'trailer', label: 'Trailer' },
              ]"
              @update:model-value="subjectId = ''"
            />
          </FormField>
          <!-- Production carries 195 tractors and 211 trailers, and a list that long is why this
               control searches. `DispatchLoadFormPage` picks a truck, a trailer and a driver the
               same way. -->
          <FormField v-slot="{ id }" label="Unit">
            <ComboSelect :id="id" v-model="subjectId" :options="equipmentOptions" placeholder="Search units…" />
          </FormField>
        </div>
      </section>

      <section aria-labelledby="new-inspection-who">
        <h3 id="new-inspection-who" class="text-sm font-semibold text-ink">Who is inspecting it</h3>
        <p class="mt-1 text-sm text-ink-muted">Only people whose qualification covers this date.</p>
        <div class="mt-4 space-y-4">
          <FormField v-slot="{ id }" label="Inspector">
            <ComboSelect :id="id" v-model="inspectorId" :options="inspectorOptions" placeholder="Search inspectors…" />
          </FormField>
          <FormField v-slot="{ id }" label="Date inspected">
            <AppDateField :id="id" v-model="inspectedOn" />
          </FormField>
        </div>
      </section>
    </form>

    <template #footer>
      <div class="flex items-center justify-end gap-3">
        <BaseButton variant="ghost" :disabled="saving" @click="emit('close')">Cancel</BaseButton>
        <BaseButton form="new-inspection-form" type="submit" variant="primary" :disabled="saving || !ready">
          {{ saving ? "Starting…" : "Start inspection" }}
        </BaseButton>
      </div>
    </template>
  </SlideOver>
</template>
