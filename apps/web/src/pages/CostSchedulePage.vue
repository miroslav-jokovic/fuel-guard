<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { FIXED_COST_CATEGORIES, truckCostScheduleSchema, type TruckCostScheduleRow } from "@silvicom/shared";
import {
  useCostSchedulesQuery,
  useCreateScheduleMutation,
  useUpdateScheduleMutation,
  useDeleteScheduleMutation,
} from "@/features/accounting/useCostSchedules";
import PageHeader from "@/components/ui/PageHeader.vue";
import { useToastStore } from "@/stores/toast";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import {
  AppCard as BaseCard,
  AppButton as BaseButton,
  AppInput as BaseInput,
  AppSelect as BaseSelect,
  AppFormField as FormField,
} from "@silvicom/ui";

// The page maintains the office's contract knowledge — the lease/insurance/GPS dollars McLeod
// structurally cannot attribute (T1, TRUCK-COST-ATTRIBUTION-PLAN). Corrections that change
// history are close-and-replace: end the old row at a month boundary, add its successor. The
// "Close" action below does exactly that first half, on purpose, instead of offering free edits
// of past amounts.
const toast = useToastStore();
const { data, isLoading, isError, error, refetch, isFetching } = useCostSchedulesQuery();
const create = useCreateScheduleMutation();
const update = useUpdateScheduleMutation();
const remove = useDeleteScheduleMutation();

const rows = computed(() => data.value ?? []);

const monthlyTotal = computed(() =>
  rows.value.filter((r) => !r.effective_to).reduce((sum, r) => sum + r.monthly_amount, 0),
);
const categoryOptions = FIXED_COST_CATEGORIES.map((c) => ({ value: c, label: c }));

const firstOfNextMonth = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString().slice(0, 10);
};

const blank = () => ({
  unit_number: "",
  category: "lease" as (typeof FIXED_COST_CATEGORIES)[number],
  label: "",
  monthly_amount: "",
  effective_from: firstOfNextMonth(),
  notes: "",
});
const form = reactive(blank());
const formError = ref<string | null>(null);
const adding = ref(false);

async function submit() {
  formError.value = null;
  const parsed = truckCostScheduleSchema.safeParse({
    ...form,
    monthly_amount: Number(form.monthly_amount),
    notes: form.notes || null,
  });
  if (!parsed.success) {
    formError.value = parsed.error.issues[0]?.message ?? "Check the form";
    return;
  }
  try {
    await create.mutateAsync(parsed.data);
    toast.success("Schedule row added", `${parsed.data.unit_number} · ${parsed.data.category} charges from ${parsed.data.effective_from}.`);
    Object.assign(form, blank());
    adding.value = false;
  } catch (e) {
    toast.error("Could not add the schedule row", e instanceof Error ? e.message : undefined);
  }
}

// Close a row at the coming month boundary — the correction path that preserves history.
async function closeRow(row: TruckCostScheduleRow) {
  try {
    const until = firstOfNextMonth();
    await update.mutateAsync({ id: row.id, patch: { effective_to: until } });
    toast.success("Schedule row closed", `${row.unit_number} · ${row.category} stops charging at ${until}. Add its successor if the cost continues.`);
  } catch (e) {
    toast.error("Could not close the schedule row", e instanceof Error ? e.message : undefined);
  }
}

async function deleteRow(row: TruckCostScheduleRow) {
  // Deletion is for typos, not corrections — a wrong amount that ever charged a report should be
  // closed, not erased. The confirm text says which one the user is doing.
  if (!window.confirm(`Delete "${row.label}" (${row.unit_number})? If this row ever charged a month, close it instead.`)) return;
  try {
    await remove.mutateAsync(row.id);
    toast.success("Schedule row deleted");
  } catch (e) {
    toast.error("Could not delete the schedule row", e instanceof Error ? e.message : undefined);
  }
}

const fmtUsd = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "USD" });

const columns: DataTableColumn[] = [
  { key: "unit_number", label: "Truck", cellClass: "font-mono text-xs" },
  { key: "category", label: "Category" },
  { key: "label", label: "Contract / policy" },
  { key: "monthly_amount", label: "Monthly", numeric: true },
  { key: "effective_from", label: "From" },
  { key: "effective_to", label: "Until" },
  { key: "actions", label: "" },
];
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="The per-truck fixed costs McLeod cannot attribute — lease, insurance, GPS, permits — entered from the signed contracts. These rows charge whole months into the cost-per-mile report; the report names every truck this schedule does not cover." />

    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <BaseCard padding="sm">
        <p class="text-xs font-semibold tracking-wide text-ink-muted uppercase">Open rows / month</p>
        <p class="text-2xl font-bold text-ink">{{ fmtUsd(monthlyTotal) }}</p>
        <p class="text-2xs text-ink-tertiary">compare against the income statement's lease + insurance + GPS lines — a shortfall means missing rows</p>
      </BaseCard>
      <BaseCard padding="sm">
        <p class="text-xs font-semibold tracking-wide text-ink-muted uppercase">Correction rule</p>
        <p class="text-sm text-ink-secondary">Amount changed? <span class="font-semibold">Close</span> the old row at a month boundary and add its successor. Delete is for typos only.</p>
      </BaseCard>
    </div>

    <FilterBar :count="rows.length" count-label="schedule rows">
      <template #actions>
        <BaseButton size="sm" :variant="adding ? 'ghost' : 'primary'" @click="adding = !adding">
          {{ adding ? "Cancel" : "Add schedule row" }}
        </BaseButton>
      </template>
    </FilterBar>

    <BaseCard v-if="adding" padding="sm">
      <form class="grid grid-cols-1 gap-3 sm:grid-cols-3" @submit.prevent="submit">
        <FormField v-slot="{ id }" label="Truck unit">
          <BaseInput :id="id" v-model="form.unit_number" placeholder="754" />
        </FormField>
        <FormField v-slot="{ id }" label="Category">
          <BaseSelect :id="id" v-model="form.category" :options="categoryOptions" />
        </FormField>
        <FormField v-slot="{ id }" label="Monthly amount (USD)">
          <BaseInput :id="id" v-model="form.monthly_amount" type="number" step="0.01" min="0.01" placeholder="2500.00" />
        </FormField>
        <FormField v-slot="{ id }" label="Contract / policy wording" class="sm:col-span-2">
          <BaseInput :id="id" v-model="form.label" placeholder="VIP Lease — unit 754" />
        </FormField>
        <FormField v-slot="{ id }" label="Effective from (first of month)" hint="whole months are charged; ranges are month-aligned">
          <BaseInput :id="id" v-model="form.effective_from" type="date" />
        </FormField>
        <p v-if="formError" class="text-sm text-danger-600 sm:col-span-3">{{ formError }}</p>
        <div class="sm:col-span-3">
          <BaseButton type="submit" size="sm" :disabled="create.isPending.value">Add row</BaseButton>
        </div>
      </form>
    </BaseCard>

    <DataTable
      :columns="columns"
      :rows="rows"
      row-key="id"
      :loading="isLoading"
      :error="isError ? (error instanceof Error ? error.message : 'Failed to load') : null"
      :retrying="isFetching"
      @retry="refetch"
    >
      <template #empty>
        <div class="space-y-1">
          <p>No fixed costs scheduled yet.</p>
          <p class="text-xs text-ink-tertiary">Until rows exist, cost per mile shows direct cost only and says so in its caveats.</p>
        </div>
      </template>
      <template #cell-monthly_amount="{ value }">{{ fmtUsd(value) }}</template>
      <template #cell-effective_to="{ value }">
        <span :class="value ? '' : 'text-ink-tertiary'">{{ value ?? "open" }}</span>
      </template>
      <template #cell-actions="{ row }">
        <div class="flex justify-end gap-2">
          <BaseButton v-if="!row.effective_to" size="sm" variant="ghost" :disabled="update.isPending.value" @click="closeRow(row as TruckCostScheduleRow)">Close</BaseButton>
          <BaseButton size="sm" variant="ghost" :disabled="remove.isPending.value" @click="deleteRow(row as TruckCostScheduleRow)">Delete</BaseButton>
        </div>
      </template>
    </DataTable>
  </div>
</template>
