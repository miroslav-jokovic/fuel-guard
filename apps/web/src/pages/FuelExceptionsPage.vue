<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { AppCard as BaseCard, AppButton as BaseButton } from "@fuelguard/ui";
import {
  FUEL_EXCEPTION_KIND_LABELS, FUEL_EXCEPTION_KINDS,
  FUEL_EXCEPTION_STATUS_LABELS, FUEL_EXCEPTION_STATUSES,
  type FuelExceptionKind, type FuelExceptionStatus,
} from "@fuelguard/shared";
import PageHeader from "@/components/ui/PageHeader.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import TablePagination from "@/components/TablePagination.vue";
import StatCard from "@/components/ui/StatCard.vue";
import DateRangeFilter from "@/components/DateRangeFilter.vue";
import ExceptionSlideOver from "@/features/reconcile/ExceptionSlideOver.vue";
import { BADGE_BASE, toneClass, fuelExceptionStatusBadge, fuelExceptionAmountTone } from "@/lib/badges";
import { useSpendFilters } from "@/features/reconcile/useSpendFilters";
import { useExceptionsQuery, useExceptionTotalsQuery } from "@/features/reconcile/useExceptions";
import { usd } from "@/features/reconcile/format";
import { downloadCsv } from "@/lib/csv";
import { apiDownload } from "@/lib/api";
import { useToastStore } from "@/stores/toast";

/**
 * The fuel exception ledger — every finding the detectors made, and what anybody did about it.
 *
 * ── WHY THIS PAGE EXISTS ─────────────────────────────────────────────────────────────────────────
 * The spend page finds money. Until F6 it then forgot it: a discrepancy had no state, no owner and no
 * resolution, so the same one was investigated twice by two people a week apart, a dispute settled
 * with Pilot left no trace it had been raised, and the product could report what it had found and
 * never what it had recovered.
 *
 * ── THREE NUMBERS, NEVER ONE ─────────────────────────────────────────────────────────────────────
 * Identified, claimed and recovered are different figures and the gap between them is the point.
 * "We found $14,200" is a claim about the software; "we recovered $14,200" is a claim about the
 * business, and only the second one renews a contract. Beneath them the four KINDS of money stay
 * apart too — recoverable, owed, and unexplained must not be added (D-FX5).
 *
 * ── THE WINDOW IS THE SAME WINDOW ────────────────────────────────────────────────────────────────
 * `useSpendFilters` owns the period here exactly as it does on the spend page, so a figure quoted off
 * one and checked against the other covers the same days. That is the whole reason it is a shared
 * composable and not a local ref.
 */
const toast = useToastStore();
const f = useSpendFilters();

const statuses = ref<FuelExceptionStatus[]>(["open", "investigating", "disputed"]);
const kinds = ref<FuelExceptionKind[]>([]);
const page = ref(1);
const PAGE_SIZE = 25;

const statusOptions = FUEL_EXCEPTION_STATUSES.map((v) => ({ value: v, label: FUEL_EXCEPTION_STATUS_LABELS[v] }));
const kindOptions = FUEL_EXCEPTION_KINDS.map((v) => ({ value: v, label: FUEL_EXCEPTION_KIND_LABELS[v] }));

const query = computed(() => ({
  status: statuses.value, kind: kinds.value,
  from: f.from.value, to: f.to.value,
  page: page.value, pageSize: PAGE_SIZE,
}));
// Narrowing while on page nine of the old result set lands on an empty page that looks like an error.
watch([statuses, kinds, () => f.from.value, () => f.to.value], () => { page.value = 1; }, { deep: true });

const { data, isLoading, isError, error } = useExceptionsQuery(query);
const rows = computed(() => data.value?.rows ?? []);
const total = computed(() => data.value?.total ?? 0);

const window = computed(() => ({ from: f.from.value, to: f.to.value }));
const { data: totals } = useExceptionTotalsQuery(window);

const tiles = computed(() => {
  const t = totals.value;
  return [
    { label: "Identified", value: usd(t?.identified ?? 0), sub: `${t?.lines ?? 0} findings` },
    { label: "Claimed", value: usd(t?.claimed ?? 0), sub: "taken to the vendor" },
    { label: "Recovered", value: usd(t?.recovered ?? 0), sub: "credited back", tone: "text-success-700" },
    { label: "Still open", value: String(t?.openLines ?? 0), sub: "need somebody" },
  ];
});

const selected = ref<string | null>(null);

const tableRows = computed(() =>
  rows.value.map((r) => ({
    id: r.id,
    date: r.occurred_on ?? "—",
    kind: FUEL_EXCEPTION_KIND_LABELS[r.kind],
    unit: r.unit_number ?? "—",
    site: [r.site_number, r.city, r.state].filter(Boolean).join(" ") || "—",
    amount: usd(Number(r.amount)),
    amountTone: fuelExceptionAmountTone(r.amount_kind),
    status: r.status,
  })),
);
const columns: DataTableColumn[] = [
  { key: "date", label: "Date", width: "sm", cellClass: "text-ink-secondary" },
  { key: "kind", label: "Finding", width: "lg" },
  { key: "unit", label: "Unit", width: "xs", cellClass: "text-ink-secondary" },
  { key: "site", label: "Site", width: "lg", cellClass: "text-ink-secondary" },
  { key: "amount", label: "Amount", numeric: true, width: "sm" },
  { key: "status", label: "Status", width: "sm" },
];

function exportCsv() {
  downloadCsv(
    `fuel-exceptions-${f.from.value}-to-${f.to.value}`,
    ["Date", "Finding", "Amount", "Kind of money", "Unit", "Site", "City", "State", "Status", "Credited", "Credited on", "Note", "First seen"],
    rows.value.map((r) => [
      r.occurred_on, FUEL_EXCEPTION_KIND_LABELS[r.kind], Number(r.amount).toFixed(2), r.amount_kind,
      r.unit_number, r.site_number, r.city, r.state,
      FUEL_EXCEPTION_STATUS_LABELS[r.status], r.credited_amount ?? "", r.credited_on ?? "",
      r.resolution_note ?? "", r.first_seen_at.slice(0, 10),
    ]),
  );
}

const packetBusy = ref(false);
/**
 * The document you send Pilot. Rendered on the server from the persisted runs, not from whatever this
 * screen is showing — a figure in a dispute packet gets quoted back months later, so it comes from the
 * same records the finding was written from.
 */
async function downloadPacket() {
  if (packetBusy.value || rows.value.length === 0) return;
  packetBusy.value = true;
  try {
    const ids = rows.value.map((r) => r.id).join(",");
    await apiDownload(`/api/fueling/exceptions/packet.pdf?ids=${ids}`, `fuel-dispute-packet-${f.from.value}.pdf`);
  } catch (e) {
    toast.error("Could not build the packet", e instanceof Error ? e.message : undefined);
  } finally {
    packetBusy.value = false;
  }
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Every finding the fuel checks made, what it is worth, and what anybody did about it." />

    <!-- Identified, claimed and recovered are three different claims. The gap between the first and
         the last is the only measure of whether this product is worth its subscription. -->
    <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <StatCard v-for="t in tiles" :key="t.label" :label="t.label" :value="t.value" :sub="t.sub" :value-tone="t.tone" />
    </div>

    <FilterBar :count="total" count-label="findings">
      <template #filters>
        <DateRangeFilter v-model:from="f.from.value" v-model:to="f.to.value" label="Dates" />
        <FilterSelect v-model="statuses" :options="statusOptions" label="Status" multiple />
        <FilterSelect v-model="kinds" :options="kindOptions" label="Finding" multiple />
      </template>
      <template #actions>
        <BaseButton variant="ghost" :disabled="!rows.length" @click="exportCsv">Export CSV</BaseButton>
        <BaseButton variant="secondary" :disabled="!rows.length || packetBusy" @click="downloadPacket">
          {{ packetBusy ? "Building…" : "Dispute packet" }}
        </BaseButton>
      </template>
    </FilterBar>

    <p v-if="isError" class="rounded-surface bg-danger-50 px-4 py-3 text-sm text-danger-700 ring-1 ring-danger-100">
      Couldn't load the ledger: {{ error instanceof Error ? error.message : "unknown error" }}
    </p>

    <BaseCard v-else padding="none">
      <DataTable
        :columns="columns"
        :rows="tableRows"
        row-key="id"
        :loading="isLoading"
        empty-text="Nothing outstanding in this window. Reconcile a report to look again."
        @row-click="selected = String($event.id)"
      >
        <template #cell-amount="{ row }">
          <span class="tabular-nums font-medium" :class="String(row.amountTone)">{{ row.amount }}</span>
        </template>
        <template #cell-status="{ row }">
          <span :class="[BADGE_BASE, toneClass(fuelExceptionStatusBadge(String(row.status)).tone)]">
            {{ fuelExceptionStatusBadge(String(row.status)).label }}
          </span>
        </template>
        <template #footer>
          <TablePagination :page="page" :page-size="PAGE_SIZE" :total="total" @update:page="page = $event" />
        </template>
      </DataTable>
    </BaseCard>

    <ExceptionSlideOver :id="selected" @close="selected = null" />
  </div>
</template>
