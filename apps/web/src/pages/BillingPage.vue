<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useInvoicesQuery, useMarginByTruckQuery, INVOICES_PAGE_SIZE } from "@/features/billing/useInvoices";
import { useDispatcherEarningsQuery } from "@/features/billing/useDispatcherEarnings";
import { useVehiclesQuery } from "@/composables/useVehicles";
import { trailingDays } from "@/lib/dateWindow";
import DateRangeFilter from "@/components/DateRangeFilter.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import TablePagination from "@/components/TablePagination.vue";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import { AppCard as BaseCard, AppButton as BaseButton } from "@silvicom/ui";
import { BADGE_BASE, toneClass } from "@/lib/badges";

/**
 * Three tabs (owner request, 2026-08-28). Hand-rolled on the house pattern — a `role="tablist"`
 * strip of `BaseButton`s on `bg-surface-muted`, as `AuditPage.vue:73` and `CompliancePage.vue:316`
 * do — because the design system still has no `Tabs` primitive and inventing one here would make it
 * the eighth hand-rolled variant rather than the first shared one.
 *
 * Margin per truck used to hang below the invoice table as a second card on the same scroll, which
 * made it look like a footnote to the invoices rather than the other half of the question. The
 * three views answer three different questions about the same window — what was billed, what each
 * truck kept, who booked it — so they get equal billing and share one date filter.
 */
type BillingTab = "invoices" | "trucks" | "dispatchers";
const TABS: { value: BillingTab; label: string }[] = [
  { value: "invoices", label: "Loads" },
  { value: "trucks", label: "Margin per truck" },
  { value: "dispatchers", label: "By dispatcher" },
];
const tab = ref<BillingTab>("invoices");

// Inclusive dates, as the picker shows them; the query layer converts to the API's exclusive bound.
const defaultWindow = trailingDays(90);
const search = ref("");
const from = ref<string>(defaultWindow.from);
const to = ref<string>(defaultWindow.to);
const page = ref(1);
watch([search, from, to], () => (page.value = 1));

const filter = computed(() => ({ q: search.value, from: from.value, to: to.value, page: page.value }));
const { data, isLoading, isError, error, refetch, isFetching } = useInvoicesQuery(filter);
const { data: margins } = useMarginByTruckQuery(from, to);
const { data: dispatchers, isLoading: dispatchersLoading } = useDispatcherEarningsQuery(from, to);
const { data: vehicles } = useVehiclesQuery();

const entries = computed(() => data.value?.entries ?? []);
const total = computed(() => data.value?.total ?? 0);
const unitById = computed(() => new Map((vehicles.value ?? []).map((v) => [v.id, v.unit_number])));

// Margin per truck, the unattributed bucket shown as its own honest row — never spread by a guess.
const marginRows = computed(() =>
  (margins.value ?? []).map((m) => ({
    ...m,
    key: m.vehicleId ?? "(unattributed)",
    unit: m.vehicleId ? (unitById.value.get(m.vehicleId) ?? m.vehicleId.slice(0, 8)) : "Unattributed",
  })),
);

// A bill whose order carried no operations user is its own row, for the same reason the
// unattributed truck is: the money exists and hiding it would make the column stop summing.
const dispatcherRows = computed(() =>
  (dispatchers.value ?? []).map((d) => ({
    ...d,
    key: d.dispatcherUserId ?? "(unassigned)",
    name: d.dispatcherName ?? d.dispatcherUserId ?? "Unassigned",
  })),
);
const dispatcherTotal = computed(() => dispatcherRows.value.reduce((a, d) => a + d.revenue, 0));
const unpostedTotal = computed(() => dispatcherRows.value.reduce((a, d) => a + d.unpostedLoads, 0));

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const fmtUsd = (n: number | string) => Number(n).toLocaleString(undefined, { style: "currency", currency: "USD" });

const invoiceColumns: DataTableColumn[] = [
  { key: "occurred_at", label: "Billed", cellClass: "text-ink-secondary" },
  { key: "category", label: "Kind" },
  { key: "dispatcher_name", label: "Dispatcher" },
  { key: "amount", label: "Amount", numeric: true },
  { key: "external_id", label: "Reference", cellClass: "font-mono text-xs text-ink-secondary" },
];
const marginColumns: DataTableColumn[] = [
  { key: "unit", label: "Truck", cellClass: "font-medium text-ink" },
  { key: "earnings", label: "Earnings", numeric: true },
  { key: "expenses", label: "Expenses", numeric: true },
  { key: "margin", label: "Margin", numeric: true },
  { key: "entries", label: "Entries", numeric: true, cellClass: "text-ink-tertiary" },
];
const dispatcherColumns: DataTableColumn[] = [
  { key: "name", label: "Dispatcher", cellClass: "font-medium text-ink" },
  { key: "loads", label: "Loads", numeric: true },
  { key: "linehaul", label: "Linehaul", numeric: true },
  { key: "accessorial", label: "Accessorial", numeric: true },
  { key: "revenue", label: "Revenue", numeric: true },
  { key: "unpostedLoads", label: "Unposted", numeric: true, cellClass: "text-ink-tertiary" },
];
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Invoiced revenue, margin per truck, and earnings per dispatcher — the earnings side of the ledger, on the same terms as cost." />

    <nav class="flex gap-1 rounded-surface bg-surface-muted p-1 text-sm" role="tablist" aria-label="Billing view">
      <BaseButton
        v-for="t in TABS"
        :id="`billing-tab-${t.value}`"
        :key="t.value"
        type="button"
        role="tab"
        class="rounded-control px-3 py-1.5 font-medium transition"
        :class="tab === t.value ? 'bg-surface text-ink' : 'text-ink-muted hover:text-ink-secondary'"
        :aria-selected="tab === t.value"
        :aria-controls="`billing-panel-${t.value}`"
        @click="tab = t.value"
      >
        {{ t.label }}
      </BaseButton>
    </nav>

    <!-- One window, three views. The date filter lives outside the panels because moving between
         tabs to compare the same month should not mean re-picking the month. -->
    <FilterBar
      v-model:search="search"
      :search-placeholder="tab === 'invoices' ? 'Search by invoice reference…' : ''"
      :count="tab === 'invoices' ? total : tab === 'trucks' ? marginRows.length : dispatcherRows.length"
      :count-label="tab === 'invoices' ? 'invoices' : tab === 'trucks' ? 'trucks' : 'dispatchers'"
    >
      <template #filters>
        <DateRangeFilter :from="from" :to="to" @update:from="(v) => (from = v ?? from)" @update:to="(v) => (to = v ?? to)" />
      </template>
    </FilterBar>

    <div v-if="tab === 'invoices'" id="billing-panel-invoices" role="tabpanel" aria-labelledby="billing-tab-invoices">
      <DataTable
        :columns="invoiceColumns"
        :rows="entries"
        row-key="id"
        :loading="isLoading"
        :error="isError ? (error instanceof Error ? error.message : 'Failed to load') : null"
        :retrying="isFetching"
        @retry="refetch"
      >
        <template #empty>
          <p>No invoiced revenue in this window. Billing rows arrive with the McLeod financial sweep — check the window, or widen it.</p>
        </template>
        <template #cell-occurred_at="{ value }">{{ fmtDate(value) }}</template>
        <template #cell-category="{ value }">
          <span :class="[BADGE_BASE, toneClass(value === 'accessorial_revenue' ? 'info' : 'success')]">
            {{ value === "accessorial_revenue" ? "Accessorial" : "Linehaul" }}
          </span>
        </template>
        <!-- Blank means the bill's order carried no operations user, not that the sweep failed. -->
        <template #cell-dispatcher_name="{ value }">
          <span :class="value ? 'text-ink-secondary' : 'text-ink-tertiary'">{{ value ?? "Unassigned" }}</span>
        </template>
        <template #cell-amount="{ value }"><span class="font-semibold text-success-700">{{ fmtUsd(value) }}</span></template>
        <template #footer>
          <TablePagination :page="page" :page-size="INVOICES_PAGE_SIZE" :total="total" @update:page="page = $event" />
        </template>
      </DataTable>
    </div>

    <div v-else-if="tab === 'trucks'" id="billing-panel-trucks" role="tabpanel" aria-labelledby="billing-tab-trucks">
      <DataTable :columns="marginColumns" :rows="marginRows" row-key="key" :loading="false" :error="null">
        <template #empty>
          <p>No margin to show for this window. Margin needs both billed revenue and posted expenses on the same truck.</p>
        </template>
        <template #cell-earnings="{ value }">{{ fmtUsd(value) }}</template>
        <template #cell-expenses="{ value }">{{ fmtUsd(value) }}</template>
        <template #cell-margin="{ value }">
          <span class="font-semibold" :class="value >= 0 ? 'text-success-700' : 'text-danger-700'">{{ fmtUsd(value) }}</span>
        </template>
      </DataTable>
    </div>

    <div v-else id="billing-panel-dispatchers" role="tabpanel" aria-labelledby="billing-tab-dispatchers" class="space-y-4">
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <BaseCard padding="sm">
          <p class="text-xs font-semibold tracking-wide text-ink-muted uppercase">Booked in the window</p>
          <p class="text-2xl font-bold text-ink">{{ fmtUsd(dispatcherTotal) }}</p>
          <p class="text-2xs text-ink-tertiary">across {{ dispatcherRows.length }} {{ dispatcherRows.length === 1 ? "dispatcher" : "dispatchers" }}</p>
        </BaseCard>
        <BaseCard padding="sm">
          <p class="text-xs font-semibold tracking-wide text-ink-muted uppercase">Staged but unbooked</p>
          <p class="text-2xl font-bold text-ink">{{ unpostedTotal }}</p>
          <p class="text-2xs text-ink-tertiary">bills the GL has not posted — held out of the figures, never dropped</p>
        </BaseCard>
      </div>

      <DataTable :columns="dispatcherColumns" :rows="dispatcherRows" row-key="key" :loading="dispatchersLoading" :error="null">
        <template #empty>
          <p>No dispatcher earnings for this window. The dispatch name arrives with the McLeod billing sweep — bills swept before that ran carry no dispatcher.</p>
        </template>
        <template #cell-linehaul="{ value }">{{ fmtUsd(value) }}</template>
        <template #cell-accessorial="{ value }">{{ fmtUsd(value) }}</template>
        <template #cell-revenue="{ value }"><span class="font-semibold text-success-700">{{ fmtUsd(value) }}</span></template>
      </DataTable>

      <p class="text-2xs text-ink-tertiary">
        Revenue counts a load once the GL booked it, the same predicate the cost-per-mile page uses, so
        these figures and the income statement agree. Excise tax is excluded — money collected for the
        government was never the carrier's earning.
      </p>
    </div>
  </div>
</template>
