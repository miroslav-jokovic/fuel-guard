<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { sortRows, toggleSort, type SortState } from "@/lib/sort";
import type { FixedCostCategory, TruckCostScheduleInput, TruckCostScheduleRow } from "@silvicom/shared";
import {
  useCostSchedulesQuery,
  useCreateScheduleMutation,
  useUpdateScheduleMutation,
  useDeleteScheduleMutation,
  useGlMonthlyCostsQuery,
} from "@/features/accounting/useCostSchedules";
import FixedCostScheduleTable from "@/features/accounting/FixedCostScheduleTable.vue";
import GlAccountsTable from "@/features/accounting/GlAccountsTable.vue";
import FixedCostForm from "@/features/accounting/FixedCostForm.vue";
import { FIXED_COST_CATEGORY_LABELS } from "@/features/accounting/fixedCostLabels";
import PageHeader from "@/components/ui/PageHeader.vue";
import StatCard from "@/components/ui/StatCard.vue";
import ExplainerPanel from "@/components/ui/ExplainerPanel.vue";
import DataWorkspace from "@/components/ui/DataWorkspace.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import SlideOver from "@/components/SlideOver.vue";
import { useToastStore } from "@/stores/toast";
import { AppButton as BaseButton, AppTabs, type TabItem } from "@silvicom/ui";

// The page maintains the office's contract knowledge — the PER-TRUCK split of lease, insurance,
// GPS and permit dollars (T1, TRUCK-COST-ATTRIBUTION-PLAN). Corrections that change history are
// close-and-replace: end the old row at a month boundary, add its successor. "Stop charging" does
// exactly that first half, on purpose, instead of offering free edits of past amounts.
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
// So the schedule stays manual — it is the only route to a per-truck fixed cost — and the ledger's
// own accounts sit on the second tab, so an empty schedule reads as what it is (nothing entered
// yet) rather than as an absence of cost.

/** The last complete month — the ledger comparison needs a month that has finished posting. */
function previousMonth(): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

type CostTab = "schedule" | "ledger";
const TABS: TabItem[] = [
  { value: "schedule", label: "What we charge each truck" },
  { value: "ledger", label: "What the ledger booked" },
];
const tab = ref<CostTab>("schedule");

const glPeriod = ref(previousMonth());
const { data: glCosts, isLoading: glLoading, isError: glIsError, error: glError } = useGlMonthlyCostsQuery(glPeriod);
const toast = useToastStore();
const { data, isLoading, isError, error, refetch, isFetching } = useCostSchedulesQuery();
const create = useCreateScheduleMutation();
const update = useUpdateScheduleMutation();
const remove = useDeleteScheduleMutation();

const rows = computed(() => data.value ?? []);
const monthlyTotal = computed(() =>
  rows.value.filter((r) => !r.effective_to).reduce((sum, r) => sum + r.monthly_amount, 0),
);

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
 * How much of the month's cost McLeod can place on something, and how much it structurally cannot.
 *
 * Measured June 2026: SET and FUEL resolve to a truck, OFF to one of 31 people, AP to one of 30
 * vendors — but GJ ($609,465) and RJ ($131,941) carry no payee at all, so lease, insurance, officer
 * salaries and payroll tax are company-level in McLeod and no amount of collecting changes that.
 */
const attributable = computed(() =>
  (glCosts.value?.accounts ?? []).filter((a) => a.grain !== "company").reduce((s, a) => s + a.amount, 0),
);
const companyOnly = computed(() =>
  (glCosts.value?.accounts ?? []).filter((a) => a.grain === "company").reduce((s, a) => s + a.amount, 0),
);

const PAGE_SIZE = 20;
const page = ref(1);
const search = ref("");
const grainFilter = ref("");
const accountSort = ref<SortState>({ key: "amount", dir: "desc" });
const onAccountSort = (key: string) => (accountSort.value = toggleSort(accountSort.value, key));
watch([search, grainFilter, glPeriod, tab], () => (page.value = 1));

const grainOptions = [
  { value: "", label: "Any" },
  { value: "per_truck", label: "To a truck" },
  { value: "per_person", label: "To a person" },
  { value: "per_vendor", label: "To a supplier" },
  { value: "company", label: "Company only" },
];

const q = computed(() => search.value.trim().toLowerCase());
const glAccounts = computed(() =>
  sortRows(
    (glCosts.value?.accounts ?? []).filter(
      (a) => (!q.value || (a.descr ?? a.glid).toLowerCase().includes(q.value)) && (!grainFilter.value || a.grain === grainFilter.value),
    ),
    accountSort.value,
  ),
);
const scheduleRows = computed(() =>
  rows.value.filter(
    (r) =>
      !q.value ||
      r.unit_number.toLowerCase().includes(q.value) ||
      r.label.toLowerCase().includes(q.value) ||
      (FIXED_COST_CATEGORY_LABELS[r.category as FixedCostCategory] ?? "").toLowerCase().includes(q.value),
  ),
);
const slice = <T,>(list: T[]) => list.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE);

const onSchedule = computed(() => tab.value === "schedule");
const visibleCount = computed(() => (onSchedule.value ? scheduleRows.value.length : glAccounts.value.length));
const hiddenAccounts = computed(() => (glCosts.value?.accounts.length ?? 0) - glAccounts.value.length);
const activeFilterCount = computed(() => (q.value ? 1 : 0) + (grainFilter.value ? 1 : 0));
function resetFilters() {
  search.value = "";
  grainFilter.value = "";
}

const drawerOpen = ref(false);
async function addRow(value: TruckCostScheduleInput) {
  try {
    await create.mutateAsync(value);
    toast.success(
      "Fixed cost added",
      `Truck ${value.unit_number} carries ${FIXED_COST_CATEGORY_LABELS[value.category]} from ${value.effective_from}.`,
    );
    drawerOpen.value = false;
  } catch (e) {
    toast.error("Could not add the fixed cost", e instanceof Error ? e.message : undefined);
  }
}

/** Close a row at the coming month boundary — the correction path that preserves history. */
async function closeRow(row: TruckCostScheduleRow) {
  try {
    const now = new Date();
    const until = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString().slice(0, 10);
    await update.mutateAsync({ id: row.id, patch: { effective_to: until } });
    toast.success("Cost stopped", `Truck ${row.unit_number} stops carrying this on ${until}. Add the new amount if the cost continues.`);
  } catch (e) {
    toast.error("Could not stop the cost", e instanceof Error ? e.message : undefined);
  }
}

async function deleteRow(row: TruckCostScheduleRow) {
  // Deletion is for typos, not corrections — a wrong amount that ever charged a report should be
  // closed, not erased. The confirm text says which one the user is doing.
  if (!window.confirm(`Delete "${row.label}" (truck ${row.unit_number})? If this cost ever charged a month, stop it instead.`)) return;
  try {
    await remove.mutateAsync(row.id);
    toast.success("Fixed cost deleted");
  } catch (e) {
    toast.error("Could not delete the fixed cost", e instanceof Error ? e.message : undefined);
  }
}

const fmtUsd = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "USD" });
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Which truck carries which monthly cost — lease, insurance, GPS, permits.">
      <template #actions>
        <BaseButton variant="primary" size="sm" @click="drawerOpen = true">Add a fixed cost</BaseButton>
      </template>
    </PageHeader>

    <ExplainerPanel summary="Why this has to be entered by hand">
      <p>
        McLeod holds every one of these dollars — the ledger for June 2026 adds up to the printed
        income statement to the cent. What it does not hold is which truck each dollar belongs to:
        none of the 29,427 ledger lines that month names a truck, and the lease arrives as six lines
        saying only “VIP LEASE”. So the split has to come from the signed contracts, and that is what
        this page is.
      </p>
      <p>
        Each line charges whole months into the cost-per-mile report. When an amount changes, do not
        edit the old line — press <span class="font-medium text-ink">Stop charging</span> so the
        months it already charged stay correct, then add a new line with the new amount. Delete is
        only for a line entered by mistake.
      </p>
      <p>
        The second tab shows what the ledger actually booked that month, account by account, so an
        empty schedule reads as “nothing entered yet” rather than “no cost”.
      </p>
    </ExplainerPanel>

    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Entered here" :value="fmtUsd(monthlyTotal)" sub="per month, charged into cost per mile" />
      <StatCard
        label="Ledger booked"
        :value="fmtUsd(glTotal)"
        :loading="glLoading"
        sub="every cost McLeod posted that month"
      />
      <StatCard
        label="Covered by this list"
        :value="glTotal > 0 ? `${Math.round(coverage * 100)}%` : '—'"
        sub="the rest is shared across all miles, never lost"
      />
      <!-- The distinction that stops "company only" reading as a backlog. GJ and RJ carry no payee
           at all, so lease, insurance, officer salaries and payroll tax cannot be split by anyone,
           at any point, no matter what we collect. -->
      <StatCard
        label="Nobody can split"
        :value="fmtUsd(companyOnly)"
        :loading="glLoading"
        :sub="`${fmtUsd(attributable)} of the month can be placed on a truck, person or supplier`"
      />
    </div>

    <AppTabs v-model="tab" :tabs="TABS" label="Fixed cost views" id-prefix="fixed-cost" />

    <DataWorkspace>
      <FilterBar
        v-model:search="search"
        embedded
        :search-placeholder="onSchedule ? 'Search by truck or contract…' : 'Search an expense account…'"
        :count="visibleCount"
        :count-label="onSchedule ? 'costs' : 'accounts'"
      >
        <template #filters>
          <FilterSelect v-if="!onSchedule" v-model="glPeriod" label="Month" :options="periodOptions" />
          <FilterSelect v-if="!onSchedule" v-model="grainFilter" label="Can be split" :options="grainOptions" />
        </template>
        <template #actions>
          <BaseButton v-if="activeFilterCount" variant="ghost" size="sm" @click="resetFilters">Clear filters</BaseButton>
        </template>
      </FilterBar>

      <p v-if="!onSchedule && hiddenAccounts > 0" class="px-4 py-2.5 text-xs text-ink-tertiary sm:px-6">
        {{ hiddenAccounts }} {{ hiddenAccounts === 1 ? "account is" : "accounts are" }} hidden by the filters
        above. The figures at the top of the page still cover the whole month.
      </p>

      <FixedCostScheduleTable
        v-if="onSchedule"
        :rows="slice(scheduleRows)"
        :page="page"
        :total="scheduleRows.length"
        :page-size="PAGE_SIZE"
        :loading="isLoading"
        :error="isError ? (error instanceof Error ? error.message : 'Failed to load') : null"
        :retrying="isFetching"
        :closing="update.isPending.value"
        :deleting="remove.isPending.value"
        :ledger-total="fmtUsd(glTotal)"
        @close="closeRow"
        @remove="deleteRow"
        @retry="refetch"
        @update:page="page = $event"
      />
      <GlAccountsTable
        v-else
        :rows="slice(glAccounts)"
        :page="page"
        :total="glAccounts.length"
        :total-unfiltered="glCosts?.accounts.length ?? 0"
        :page-size="PAGE_SIZE"
        :sort="accountSort"
        :loading="glLoading"
        :error="glIsError ? (glError instanceof Error ? glError.message : 'Failed to load') : null"
        :swept="glCosts?.swept ?? false"
        :accounts-staged="glCosts?.accountsStaged ?? false"
        @sort="onAccountSort"
        @update:page="page = $event"
      />
    </DataWorkspace>

    <SlideOver :open="drawerOpen" title="Add a fixed cost" description="One truck, one cost, charged every month from the date you pick." @close="drawerOpen = false">
      <FixedCostForm v-if="drawerOpen" :submitting="create.isPending.value" @submit="addRow" @cancel="drawerOpen = false" />
    </SlideOver>
  </div>
</template>
