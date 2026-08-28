<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { sortRows, toggleSort, type SortState } from "@/lib/sort";
import { FIXED_COST_CATEGORIES, truckCostScheduleSchema, type TruckCostScheduleRow } from "@silvicom/shared";
import {
  useCostSchedulesQuery,
  useCreateScheduleMutation,
  useUpdateScheduleMutation,
  useDeleteScheduleMutation,
  useGlMonthlyCostsQuery,
  type CostGrain,
} from "@/features/accounting/useCostSchedules";
import PageHeader from "@/components/ui/PageHeader.vue";
import { useToastStore } from "@/stores/toast";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import {
  AppCard as BaseCard,
  AppButton as BaseButton,
  AppInput as BaseInput,
  AppSelect as BaseSelect,
  AppFormField as FormField,
} from "@silvicom/ui";

// The page maintains the office's contract knowledge — the PER-TRUCK split of lease, insurance,
// GPS and permit dollars (T1, TRUCK-COST-ATTRIBUTION-PLAN). Corrections that change history are
// close-and-replace: end the old row at a month boundary, add its successor. The "Close" action
// below does exactly that first half, on purpose, instead of offering free edits of past amounts.
//
// The framing here was wrong until 2026-08-28 and the owner caught it. The page said these were
// "the fixed costs McLeod cannot attribute" over an empty table, which reads as a claim McLeod does
// not HOLD the money. It does — all of it. Rebuilding June 2026 out of `gl_ledger` through McLeod's
// own account classes reproduces the owner's printed income statement to the cent. What McLeod has
// no record of is the per-TRUCK split, and that was measured rather than assumed: `gl_ledger` HAS a
// `tractor` column and 0 of 29,427 June lines fill it; AP carries no equipment coding anywhere; and
// McLeod's profitability-costing module, which exists precisely for this, was never configured by
// this carrier. VIP Lease arrives as six journal lines saying "VIP LEASE".
//
// So the schedule stays manual — it is the only route to a per-truck fixed cost — and the GL panel
// below shows the month's actual expense accounts next to it, so an empty schedule reads as what it
// is (nothing entered yet) rather than as an absence of cost.
const glPeriod = ref(previousMonth());
const { data: glCosts, isLoading: glLoading } = useGlMonthlyCostsQuery(glPeriod);
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

/** The last complete month — the GL panel compares against a month that has finished posting. */
function previousMonth(): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** The last twelve complete months, newest first — enough to check a schedule against history. */
const periodOptions = computed(() => {
  const now = new Date();
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 1 - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    return { value, label: d.toLocaleDateString(undefined, { month: "long", year: "numeric" }) };
  });
});

// The comparison the page exists to make visible: what the schedule charges per month against what
// the ledger actually booked. Deliberately NOT a per-category match — mapping a GL account to one
// of our five categories is a human judgement, and inferring it from account names is exactly the
// kind of invented attribution D-MC12 forbids the extraction layer from making.
const glTotal = computed(() => glCosts.value?.total ?? 0);
const coverage = computed(() => (glTotal.value > 0 ? monthlyTotal.value / glTotal.value : 0));

/**
 * EVERY account, not a top slice. The page showed `.slice(0, 12)` until 2026-08-28 and the owner
 * caught it: June posts 69 expense accounts totalling $3,634,060.11, so office payroll, salaries,
 * payroll tax and rent were all present in the data and cut off the screen. A cost report that
 * silently truncates is worse than one that loads slowly.
 */
const accountSearch = ref("");
const grainFilter = ref("");
const accountSort = ref<SortState>({ key: "amount", dir: "desc" });
const onAccountSort = (key: string) => (accountSort.value = toggleSort(accountSort.value, key));

const GRAIN_LABELS: Record<CostGrain, string> = {
  per_truck: "Per truck",
  per_person: "Per person",
  per_vendor: "Per vendor",
  company: "Company only",
};
const grainOptions = [
  { value: "", label: "Any attribution" },
  { value: "per_truck", label: "Per truck" },
  { value: "per_person", label: "Per person" },
  { value: "per_vendor", label: "Per vendor" },
  { value: "company", label: "Company only" },
];

const glAccounts = computed(() => {
  const q = accountSearch.value.trim().toLowerCase();
  const rows = (glCosts.value?.accounts ?? []).filter(
    (a) =>
      (!q || (a.descr ?? a.glid).toLowerCase().includes(q)) &&
      (!grainFilter.value || a.grain === grainFilter.value),
  );
  return sortRows(rows, accountSort.value);
});
const hiddenAccounts = computed(() => (glCosts.value?.accounts.length ?? 0) - glAccounts.value.length);
const accountFilterCount = computed(() => (accountSearch.value.trim() ? 1 : 0) + (grainFilter.value ? 1 : 0));
function resetAccountFilters() {
  accountSearch.value = "";
  grainFilter.value = "";
}

/**
 * How much of the month's cost McLeod can place on something, and how much it structurally cannot.
 *
 * Measured June 2026: SET and FUEL resolve to a truck, OFF to one of 31 people, AP to one of 30
 * vendors — but GJ ($609,465) and RJ ($131,941) carry no payee at all, so lease, insurance, officer
 * salaries and payroll tax are company-level in McLeod and no amount of collecting changes that.
 * The split is shown because "company only" must read as a property of the source, not as a backlog.
 */
const attributable = computed(() =>
  (glCosts.value?.accounts ?? []).filter((a) => a.grain !== "company").reduce((s, a) => s + a.amount, 0),
);
const companyOnly = computed(() =>
  (glCosts.value?.accounts ?? []).filter((a) => a.grain === "company").reduce((s, a) => s + a.amount, 0),
);

const glAccountColumns: DataTableColumn[] = [
  { key: "descr", label: "Account", sortable: true },
  { key: "typeId", label: "Class", cellClass: "text-ink-tertiary", sortable: true },
  { key: "modules", label: "Posted via", cellClass: "font-mono text-xs text-ink-tertiary" },
  { key: "grain", label: "Attributable", sortable: true },
  { key: "amount", label: "Month", numeric: true, sortable: true },
];

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
    <PageHeader description="Which truck carries which fixed cost — lease, insurance, GPS, permits — entered from the signed contracts. McLeod holds every one of these dollars; what it has no record of is the per-truck split, so this schedule supplies it. These rows charge whole months into the cost-per-mile report, and the report names every truck this schedule does not cover." />

    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <BaseCard padding="sm">
        <p class="text-xs font-semibold tracking-wide text-ink-muted uppercase">Scheduled / month</p>
        <p class="text-2xl font-bold text-ink">{{ fmtUsd(monthlyTotal) }}</p>
        <p class="text-xs text-ink-tertiary">open rows, charged whole into cost per mile</p>
      </BaseCard>
      <BaseCard padding="sm">
        <p class="text-xs font-semibold tracking-wide text-ink-muted uppercase">Booked in the ledger</p>
        <p class="text-2xl font-bold text-ink">{{ glLoading ? "…" : fmtUsd(glTotal) }}</p>
        <p class="text-xs text-ink-tertiary">
          every expense account McLeod posted that month — the pool this schedule splits
        </p>
      </BaseCard>
      <BaseCard padding="sm">
        <p class="text-xs font-semibold tracking-wide text-ink-muted uppercase">Attributed to a truck</p>
        <p class="text-2xl font-bold text-ink">{{ glTotal > 0 ? `${Math.round(coverage * 100)}%` : "—" }}</p>
        <p class="text-xs text-ink-tertiary">
          the rest stays fleet overhead in the cost-per-mile report, never lost
        </p>
      </BaseCard>
      <!-- The distinction that stops "company only" reading as a backlog. GJ and RJ carry no payee
           at all, so lease, insurance, officer salaries and payroll tax cannot be split by anyone,
           at any point, no matter what we collect. -->
      <BaseCard padding="sm">
        <p class="text-xs font-semibold tracking-wide text-ink-muted uppercase">McLeod cannot split</p>
        <p class="text-2xl font-bold text-ink">{{ glLoading ? "…" : fmtUsd(companyOnly) }}</p>
        <p class="text-xs text-ink-tertiary">
          posted with no truck, person or vendor — {{ fmtUsd(attributable) }} of the month can be placed
        </p>
      </BaseCard>
    </div>

    <!-- McLeod's own accounts, its own descriptions, its own classes (0272). No category is
         inferred here: which of our five categories an account belongs to is a human judgement,
         and guessing it from an account name is the invented attribution D-MC12 rules out. -->
    <!-- The month's expense accounts, every one of them, as a DataTable inside a padding="none"
         card — the design contract's one table primitive, not a hand-rolled list. It carries its own
         FilterBar because 69 accounts is a list you search, not one you scan. -->
    <FilterBar
      v-model:search="accountSearch"
      search-placeholder="Search an expense account…"
      :count="glAccounts.length"
      count-label="accounts"
    >
      <template #filters>
        <FilterSelect v-model="glPeriod" label="Month" :options="periodOptions" />
        <FilterSelect v-model="grainFilter" label="Attributable" :options="grainOptions" />
      </template>
      <template #actions>
        <BaseButton v-if="accountFilterCount" variant="ghost" size="sm" @click="resetAccountFilters">Clear filters</BaseButton>
      </template>
    </FilterBar>

    <p v-if="hiddenAccounts > 0" class="text-xs text-ink-tertiary">
      {{ hiddenAccounts }} {{ hiddenAccounts === 1 ? "account" : "accounts" }} hidden by the filters above.
      The figures in the cards cover every account in the month.
    </p>

    <BaseCard padding="none">
      <DataTable
        :columns="glAccountColumns"
        :rows="glAccounts"
        row-key="glid"
        :loading="glLoading"
        :error="null"
        :sort="accountSort"
        @sort="onAccountSort"
      >
        <template #empty>
          <div v-if="!glCosts?.swept" class="space-y-1">
            <p>The general ledger is not swept for this month yet.</p>
            <p class="text-xs text-ink-tertiary">Run the McLeod agent's financial pass, then this table fills in.</p>
          </div>
          <div v-else-if="!glCosts?.accountsStaged" class="space-y-1">
            <p>The chart of accounts has not been staged, so the ledger's dollars cannot be classified.</p>
            <p class="text-xs text-ink-tertiary">Run the McLeod agent's financial pass — it sweeps the account master whole.</p>
          </div>
          <div v-else class="space-y-1">
            <p>No account matches these filters.</p>
            <p class="text-xs text-ink-tertiary">{{ glCosts.accounts.length }} accounts posted this month. Clear the filters to see them.</p>
          </div>
        </template>
        <template #cell-descr="{ row }">{{ row.descr ?? row.glid }}</template>
        <template #cell-modules="{ value }">{{ (value as string[]).join(" · ") }}</template>
        <!-- "Company only" is a property of McLeod, not a backlog item, so it reads as a plain
             statement rather than a warning. -->
        <template #cell-grain="{ value }">
          <span :class="value === 'company' ? 'text-ink-tertiary' : 'text-ink-secondary'">
            {{ GRAIN_LABELS[value as CostGrain] }}
          </span>
        </template>
        <template #cell-amount="{ value }">{{ fmtUsd(value) }}</template>
      </DataTable>
    </BaseCard>

    <BaseCard padding="sm">
      <p class="text-xs font-semibold tracking-wide text-ink-muted uppercase">Correction rule</p>
      <p class="text-sm text-ink-secondary">Amount changed? <span class="font-semibold">Close</span> the old row at a month boundary and add its successor. Delete is for typos only.</p>
    </BaseCard>

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
          <p class="text-xs text-ink-tertiary">
            The ledger booked {{ fmtUsd(glTotal) }} of expenses that month, none of it split per truck.
            Until rows exist here, cost per mile shows direct cost only and says so in its caveats.
          </p>
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
