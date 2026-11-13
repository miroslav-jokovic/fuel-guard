<script setup lang="ts">
import { computed, watch } from "vue";
import { LUMPER_CASE_STATES, LUMPER_CASE_STATE_LABELS, isLumperCaseOpen, type LumperCaseRow } from "@silvicom/shared";
import { AppBadge, AppCallout, DataTable, DataWorkspace, FilterBar, TablePagination, useQueryState, type DataTableColumn } from "@silvicom/ui";
import PageHeader from "@/components/ui/PageHeader.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import LumperCaseDrawer from "@/features/lumper/LumperCaseDrawer.vue";
import { useLumperCasesQuery } from "@/features/lumper/useLumperCases";
import { LUMPER_STATE_TONE, lumperAmount, lumperDaysOpen, lumperPlace, matchesLumperSearch, mcleodDay, sweepFreshness, usd } from "@/features/lumper/lumperRows";

/**
 * Lumper fees (LUMPER-REVISED-RC-PLAN D-LRC5): every load where we paid a lumper, oldest first, with
 * what we paid, where, and whether the broker's revised rate confirmation is on file. The reminders
 * will point here; nothing depends on anybody reading a notification.
 *
 * The list opens on the cases that still need somebody. "Show closed" adds the finished ones, so a
 * case that left the list can be found again. Search, status, that switch, the page and the open case
 * are in the URL (D-US2): a reminder can link to one case, and Back returns to the same list.
 */
const PAGE_SIZE = 50;
const qs = useQueryState();
const search = qs.param("search");
const state = qs.param("state", LUMPER_CASE_STATES);
const show = qs.param("show", ["all"] as const);
const openId = qs.param("case");
const page = qs.page();
watch([search, state, show], () => (page.value = 1));

const scope = computed<"open" | "all">(() => (show.value === "all" ? "all" : "open"));
const { data, isLoading, isError, isFetching, refetch } = useLumperCasesQuery(scope);

const now = new Date();
const rows = computed(() =>
  (data.value?.cases ?? [])
    .filter((c) => (!state.value || c.state === state.value) && matchesLumperSearch(c, search.value))
    .map((c) => ({ ...c, daysOpen: lumperDaysOpen(c, now) }))
    // Oldest first (D-LRC5): the case that has waited longest is the one most likely to go unpaid.
    .sort((a, b) => Number(b.open) - Number(a.open) || b.daysOpen - a.daysOpen || a.orderId.localeCompare(b.orderId)),
);
const pageRows = computed(() => rows.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));
const openCase = computed<LumperCaseRow | null>(() => (data.value?.cases ?? []).find((c) => c.id === openId.value) ?? null);
const unmatched = computed(() => data.value?.unmatchedPayments ?? []);
const freshness = computed(() => (data.value ? sweepFreshness(data.value.sweptAt, now) : null));
const waitingMoney = computed(() => rows.value.filter((c) => c.open).reduce((t, c) => t + (c.paidAmount || c.chargeAmount), 0));

const stateOptions = computed(() =>
  LUMPER_CASE_STATES.filter((s) => scope.value === "all" || isLumperCaseOpen(s)).map((s) => ({ value: s, label: LUMPER_CASE_STATE_LABELS[s] })),
);
const showOptions = [{ value: "all", label: "Show closed cases too" }];
const activeFilterCount = computed(() => (search.value.trim() ? 1 : 0) + (state.value ? 1 : 0) + (show.value ? 1 : 0));
function resetFilters() {
  qs.set({ search: undefined, state: undefined, show: undefined });
}

const columns: DataTableColumn[] = [
  { key: "orderId", label: "Order", cellClass: "font-mono text-xs" },
  { key: "customerName", label: "Broker" },
  { key: "place", label: "Delivered at" },
  { key: "dispatcherName", label: "Dispatcher" },
  { key: "paid", label: "Paid", numeric: true },
  { key: "rcOnFile", label: "Revised RC" },
  { key: "state", label: "Status" },
  { key: "daysOpen", label: "Days", numeric: true },
];
const unmatchedColumns: DataTableColumn[] = [
  { key: "transactedAt", label: "Date", cellClass: "text-ink-secondary" },
  { key: "amount", label: "Amount", numeric: true },
  { key: "referenceNo", label: "EFS reference", cellClass: "font-mono text-xs" },
  { key: "driverCode", label: "Driver" },
  { key: "tractorUnit", label: "Truck" },
  { key: "pending", label: "Settlement" },
];
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Every load where we paid a lumper: what we paid, where, and whether the broker's revised rate confirmation is on file. Without the revised RC the broker may not pay us back." />

    <AppCallout v-if="freshness?.late" tone="caution" data-test="feed">{{ freshness.text }}</AppCallout>
    <p v-else-if="freshness" class="-mt-3 text-xs text-ink-tertiary" data-test="feed">{{ freshness.text }}</p>

    <DataWorkspace>
      <FilterBar
        v-model:search="search"
        embedded
        search-placeholder="Search by order, broker, dispatcher or EFS reference…"
        :count="rows.length"
        count-label="cases"
        :active-count="activeFilterCount"
        @clear-all="resetFilters"
      >
        <template #filters>
          <FilterSelect v-model="state" label="Status" :options="stateOptions" />
          <FilterSelect v-model="show" label="Closed" :options="showOptions" />
        </template>
      </FilterBar>

      <DataTable
        :columns="columns"
        :rows="pageRows"
        embedded
        row-key="id"
        :loading="isLoading"
        :error="isError ? 'Could not load the lumper fees.' : null"
        :retrying="isFetching"
        @retry="refetch"
        @row-click="(row) => (openId = row.id)"
      >
        <template #empty>
          <p v-if="activeFilterCount">No lumper case matches these filters.</p>
          <p v-else>No open lumper cases. Every lumper we know of is invoiced with its revised RC on file, or closed.</p>
        </template>
        <template #cell-customerName="{ value }">{{ value ?? "—" }}</template>
        <template #cell-place="{ row }">
          <span class="text-ink-secondary">{{ lumperPlace(row) }}</span>
        </template>
        <!-- Blank means the order carries no operations user in McLeod, not that the read failed. -->
        <template #cell-dispatcherName="{ value }">
          <span :class="value ? 'text-ink-secondary' : 'text-ink-tertiary'">{{ value ?? "Unassigned" }}</span>
        </template>
        <template #cell-paid="{ row }">
          <span class="font-semibold" :title="lumperAmount(row).note ?? undefined">{{ lumperAmount(row).text }}</span>
          <span v-if="lumperAmount(row).note" class="block text-xs font-normal text-ink-tertiary">keyed</span>
        </template>
        <template #cell-rcOnFile="{ value }">
          <AppBadge :tone="value ? 'success' : 'caution'">{{ value ? "On file" : "Missing" }}</AppBadge>
        </template>
        <template #cell-state="{ row }">
          <AppBadge :tone="LUMPER_STATE_TONE[row.state]">{{ LUMPER_CASE_STATE_LABELS[row.state] }}</AppBadge>
        </template>
        <template #footer>
          <div class="flex flex-wrap items-center justify-between gap-3">
            <p v-if="waitingMoney > 0" class="px-4 text-sm text-ink-secondary" data-test="waiting-money">{{ usd(waitingMoney) }} in lumpers on the open cases listed.</p>
            <TablePagination :page="page" :page-size="PAGE_SIZE" :total="rows.length" :loading="isFetching" @update:page="page = $event" />
          </div>
        </template>
      </DataTable>
    </DataWorkspace>

    <section v-if="unmatched.length" aria-labelledby="lumper-unmatched-heading" class="space-y-3" data-test="unmatched">
      <div>
        <h2 id="lumper-unmatched-heading" class="text-lg font-semibold text-ink">Lumper paid, order unknown</h2>
        <p class="text-sm text-ink-muted">Payroll recorded these lumpers with no order number, so no case could be opened. Adding the order number to the settlement line in McLeod puts them on the list above.</p>
      </div>
      <!-- ui-adoption: never-empty — the section is drawn only when there is at least one such line. -->
      <!-- ui-adoption: unpaged — about one settlement line in thirteen has no order; three in the ninety days measured. -->
      <DataTable :columns="unmatchedColumns" :rows="unmatched" row-key="id">
        <template #cell-transactedAt="{ value }">{{ mcleodDay(value) }}</template>
        <template #cell-amount="{ value }">{{ usd(value) }}</template>
        <template #cell-referenceNo="{ value }">{{ value ?? "—" }}</template>
        <template #cell-driverCode="{ value }">{{ value ?? "—" }}</template>
        <template #cell-tractorUnit="{ value }">{{ value ?? "—" }}</template>
        <template #cell-pending="{ value }">{{ value ? "Not settled yet" : "Settled" }}</template>
      </DataTable>
    </section>

    <LumperCaseDrawer :lumper-case="openCase" @close="openId = ''" />
  </div>
</template>
