<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { useMutation, useQueryClient } from "@tanstack/vue-query";
import type { QualificationSeedRequest } from "@silvicom/shared";
import {
  AppCard as BaseCard,
  AppButton as BaseButton,
  AppInput as BaseInput,
  AppDateField,
  AppCheckbox as BaseCheckbox,
  AppFormField as FormField,
  DataTable,
  type DataTableColumn,
} from "@silvicom/ui";
import { apiFetch } from "@/lib/api";
import { useToastStore } from "@/stores/toast";

/**
 * H-CS — the qualification-file SEEDING grid (the F-H1 operational unlock). One row per driver:
 * CDL expiry, medical expiry, endorsement letters, one training date + provider (expanded
 * server-side to all four §172.704(a) types). Blank fields seed nothing; existing certifications
 * are never superseded (skipExisting). This is data entry at roster speed — the per-driver
 * CertManager stays the place for corrections, documents and history.
 */
const props = defineProps<{
  drivers: Array<{ id: string; full_name: string; state: string }>;
  /** True when the org already holds current PHMSA/financial certs (hides the carrier card). */
  orgSeeded: boolean;
}>();
const emit = defineEmits<{ seeded: [] }>();

interface SeedRow {
  driverId: string;
  name: string;
  state: string;
  cdl: string;
  medical: string;
  h: boolean;
  n: boolean;
  x: boolean;
  trainingDate: string;
}
const rows = reactive<SeedRow[]>(
  props.drivers
    .filter((d) => d.state !== "qualified")
    .map((d) => ({ driverId: d.id, name: d.full_name, state: d.state, cdl: "", medical: "", h: false, n: false, x: false, trainingDate: "" })),
);
// D-US4: the entry grid is a DataTable whose cells hold the inputs; each slot's row is the reactive row.
const seedColumns: DataTableColumn[] = [
  { key: "name", label: "Driver", cellClass: "font-medium text-ink" },
  { key: "cdl", label: "CDL expires" },
  { key: "medical", label: "Medical expires" },
  { key: "endorsements", label: "Endorsements" },
  { key: "trainingDate", label: "Hazmat training completed" },
];
const trainingProvider = ref("");
const orgPhmsa = ref("");
const orgFinancial = ref("");

/** Fill-down: copy the first filled row's dates/letters onto every still-blank row below. */
function fillDown() {
  const src = rows.find((r) => r.cdl || r.medical || r.trainingDate || r.h || r.n || r.x);
  if (!src) return;
  for (const r of rows) {
    if (r === src) continue;
    if (!r.cdl && !r.medical && !r.trainingDate && !r.h && !r.n && !r.x) {
      Object.assign(r, { cdl: src.cdl, medical: src.medical, trainingDate: src.trainingDate, h: src.h, n: src.n, x: src.x });
    }
  }
}

const rowHasData = (r: SeedRow): boolean => Boolean(r.cdl || r.medical || r.trainingDate || r.h || r.n || r.x);
const filledCount = computed(() => rows.filter(rowHasData).length);
const trainingNeedsProvider = computed(() => rows.some((r) => r.trainingDate) && !trainingProvider.value.trim());
const canSave = computed(
  () => (filledCount.value > 0 || orgPhmsa.value || orgFinancial.value) && !trainingNeedsProvider.value,
);

const toast = useToastStore();
const qc = useQueryClient();
const seed = useMutation({
  mutationFn: async (req: QualificationSeedRequest) => {
    const res = await apiFetch<{ created: number; skipped: number; failed: Array<{ kind: string; error: string }> }>(
      "/api/compliance/certifications/seed",
      { method: "POST", body: req },
    );
    if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Seeding failed.");
    return res.data;
  },
  onSuccess: () => void qc.invalidateQueries({ queryKey: ["compliance"] }),
});

async function save() {
  const req: QualificationSeedRequest = {
    drivers: rows.filter(rowHasData).map((r) => ({
      driverId: r.driverId,
      cdlExpiresAt: r.cdl || null,
      medicalExpiresAt: r.medical || null,
      endorsements: ([r.h && "H", r.n && "N", r.x && "X"].filter(Boolean)) as Array<"H" | "N" | "X">,
      trainingCompletedAt: r.trainingDate || null,
      trainingProviderName: r.trainingDate ? trainingProvider.value.trim() : null,
    })),
    org:
      orgPhmsa.value || orgFinancial.value
        ? { phmsaRegistrationExpiresAt: orgPhmsa.value || null, financialResponsibilityExpiresAt: orgFinancial.value || null }
        : null,
    skipExisting: true,
  };
  try {
    const r = await seed.mutateAsync(req);
    const bits = [`${r.created} recorded`];
    if (r.skipped) bits.push(`${r.skipped} already on file`);
    if (r.failed.length) bits.push(`${r.failed.length} failed`);
    (r.failed.length ? toast.error : toast.success)("Qualification files seeded", bits.join(" · "));
    if (!r.failed.length) emit("seeded");
  } catch (e) {
    toast.error("Could not seed the files", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <div class="space-y-4">
    <BaseCard v-if="!orgSeeded" as="section">
      <h2 class="text-sm font-semibold text-ink">Carrier file</h2>
      <p class="mt-1 text-sm text-ink-muted">
        The company's own certifications — every load is blocked until these exist too.
      </p>
      <div class="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField v-slot="{ id }" label="PHMSA hazmat registration expires" hint="The carrier's registration with PHMSA.">
          <AppDateField :id="id" v-model="orgPhmsa" />
        </FormField>
        <FormField v-slot="{ id }" label="Financial responsibility (insurance) expires" hint="The filing on record with FMCSA.">
          <AppDateField :id="id" v-model="orgFinancial" />
        </FormField>
      </div>
    </BaseCard>

    <BaseCard as="section">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 class="text-sm font-semibold text-ink">Driver files — bulk entry</h2>
          <p class="mt-1 max-w-2xl text-sm text-ink-muted">
            Blank fields record nothing. One training date expands to all four hazmat training areas
            (general awareness, function-specific, safety, security awareness) under the provider
            below. Kinds a driver already has on file are skipped, never overwritten.
          </p>
        </div>
        <BaseButton variant="secondary" size="sm" @click="fillDown">Fill blank rows from first</BaseButton>
      </div>

      <FormField
        v-slot="{ id }"
        class="mt-4 max-w-md"
        label="Training provider"
        :hint="trainingNeedsProvider ? 'Required for the training dates entered below.' : 'Applies to every training date in the grid.'"
      >
        <BaseInput :id="id" v-model="trainingProvider" placeholder="e.g. J. J. Keller & Associates" />
      </FormField>

      <DataTable
        class="mt-4"
        embedded
        :sticky-header="false"
        :columns="seedColumns"
        :rows="rows"
        row-key="driverId"
        empty-text="Every driver already has a qualification file under way. 🎉"
      >
        <template #cell-cdl="{ row }"><AppDateField v-model="row.cdl" :aria-label="`CDL expiry for ${row.name}`" /></template>
        <template #cell-medical="{ row }"><AppDateField v-model="row.medical" :aria-label="`Medical expiry for ${row.name}`" /></template>
        <template #cell-endorsements="{ row }">
          <div class="flex items-center gap-3">
            <BaseCheckbox v-model="row.h">H</BaseCheckbox>
            <BaseCheckbox v-model="row.n">N</BaseCheckbox>
            <BaseCheckbox v-model="row.x">X</BaseCheckbox>
          </div>
        </template>
        <template #cell-trainingDate="{ row }">
          <AppDateField v-model="row.trainingDate" :aria-label="`Training completion for ${row.name}`" />
        </template>
      </DataTable>

      <div class="mt-4 flex items-center gap-3">
        <BaseButton variant="primary" :disabled="!canSave || seed.isPending.value" @click="save">
          {{ seed.isPending.value ? "Recording…" : `Record ${filledCount} driver file${filledCount === 1 ? "" : "s"}` }}
        </BaseButton>
        <span v-if="trainingNeedsProvider" class="text-xs text-danger-600">Enter the training provider for the dates entered.</span>
        <span v-else-if="!canSave" class="text-xs text-ink-muted">Fill at least one field to record.</span>
      </div>
    </BaseCard>
  </div>
</template>
