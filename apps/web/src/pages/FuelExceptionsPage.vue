<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { AppCard as BaseCard, AppButton as BaseButton } from "@silvicom/ui";
import {
  FUEL_EXCEPTION_KIND_LABELS, FUEL_EXCEPTION_KINDS,
  FUEL_EXCEPTION_STATUS_LABELS, FUEL_EXCEPTION_STATUSES,
  type FuelExceptionKind, type FuelExceptionStatus,
} from "@silvicom/shared";
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
import { useExceptionsQuery, useExceptionTotalsQuery, exceptionExportQuery, type ExceptionQuery } from "@/features/reconcile/useExceptions";
import { usd } from "@/features/reconcile/format";
import { apiDownload } from "@/lib/api";
import { useToastStore } from "@/stores/toast";
import { useSessionStore } from "@/stores/session";
import { useQueryState } from "@/composables/useQueryState";
import { useVehiclesQuery } from "@/composables/useVehicles";
import ExportButton from "@/components/ExportButton.vue";

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
const session = useSessionStore();
const f = useSpendFilters();
const { param } = useQueryState();

/**
 * ── EVERY FILTER ON THIS PAGE IS NOW IN THE URL (FUEL-C3, D-FUI8, finished at P3) ───────────────
 * The window and the trucks always were, through `useSpendFilters`. Status and kind were local `ref`s,
 * so the one view somebody actually forwards — "the open disputes for these two trucks" — could not be
 * sent, and the EXPORT could not honour them either: a file that ignored the status filter would be
 * wider than the list above it, which is the failure that looks like a working download.
 *
 * The defaults are the work queue. They are written as the ABSENCE of the parameter rather than as
 * `?status=open,investigating,disputed`, so a link that says nothing means the queue and a link that
 * says something means exactly what it says.
 */
const DEFAULT_STATUSES: FuelExceptionStatus[] = ["open", "investigating", "disputed"];
const statusParam = param("status");
const kindParam = param("kind");
const statuses = computed<FuelExceptionStatus[]>({
  get: () => {
    const named = statusParam.value.split(",").filter((v): v is FuelExceptionStatus =>
      (FUEL_EXCEPTION_STATUSES as readonly string[]).includes(v));
    return named.length ? named : DEFAULT_STATUSES;
  },
  set: (v) => (statusParam.value = v.length ? v.join(",") : ""),
});
const kinds = computed<FuelExceptionKind[]>({
  get: () => kindParam.value.split(",").filter((v): v is FuelExceptionKind =>
    (FUEL_EXCEPTION_KINDS as readonly string[]).includes(v)),
  set: (v) => (kindParam.value = v.length ? v.join(",") : ""),
});

/**
 * "Assigned to me", and deliberately nothing more.
 *
 * The API has always accepted `assignedTo` and nothing ever sent it (A3's sibling). A full owner
 * PICKER would need a member directory, and `/api/members` is `requireRole("admin")` — so building one
 * would have put a control on this page that works for one role and reads as broken for the accountant
 * and the dispatcher who live in this ledger. That is the "component placed where the permission check
 * happens to pass" shape CLAUDE.md names, and the blocker is written into the plan (Q-FUI4) rather than
 * routed around. `mine` needs no directory: it is the caller's own id.
 */
const mine = param("owner", ["me"]);
const assignedTo = computed(() => (mine.value === "me" ? (session.userId ?? null) : null));

const page = ref(1);
const PAGE_SIZE = 25;

const statusOptions = FUEL_EXCEPTION_STATUSES.map((v) => ({ value: v, label: FUEL_EXCEPTION_STATUS_LABELS[v] }));
const kindOptions = FUEL_EXCEPTION_KINDS.map((v) => ({ value: v, label: FUEL_EXCEPTION_KIND_LABELS[v] }));

const query = computed<ExceptionQuery>(() => ({
  status: statuses.value, kind: kinds.value,
  vehicleIds: f.vehicleIds.value, assignedTo: assignedTo.value,
  from: f.from.value, to: f.to.value,
  page: page.value, pageSize: PAGE_SIZE,
}));
// Narrowing while on page nine of the old result set lands on an empty page that looks like an error.
watch(
  [statuses, kinds, () => f.from.value, () => f.to.value, () => f.vehicleIds.value, assignedTo],
  () => { page.value = 1; },
  { deep: true },
);

const { data, isLoading, isError, error } = useExceptionsQuery(query);
const rows = computed(() => data.value?.rows ?? []);
const total = computed(() => data.value?.total ?? 0);

const window = computed(() => ({
  from: f.from.value, to: f.to.value,
  vehicleIds: f.vehicleIds.value, assignedTo: assignedTo.value,
}));
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

/**
 * FUEL-P2/P3 — the file, rendered on the server over the WHOLE filtered set.
 *
 * ⚠ This button used to serialise `rows.value`: the 25 rows on the current page. A controller
 * assembling a claim got page one of a filtered ledger with nothing saying so, while the four tiles
 * above it reported the whole window's money. A smaller export is one thing; an export that disagrees
 * with the tiles above the button it came from is another.
 */
const exportTarget = computed(() => ({
  href: `/api/fueling/exceptions/export.csv?${exceptionExportQuery(query.value)}`,
  filename: `fuel-findings-${f.from.value}-to-${f.to.value}.csv`,
  scope: `${f.from.value} → ${f.to.value} · ${f.vehicleIds.value.length === 0 ? "all trucks" : `${f.vehicleIds.value.length} truck${f.vehicleIds.value.length === 1 ? "" : "s"}`}`,
}));

/** The fleet, for the truck filter. Unit numbers on the menu, vehicle ids in the URL — this section's
 *  one truck vocabulary, resolved to the ledger's own `unit_number` by the API. */
const { data: vehicles } = useVehiclesQuery();
const truckOptions = computed(() =>
  [...(vehicles.value ?? [])]
    .sort((a, b) => a.unit_number.localeCompare(b.unit_number, undefined, { numeric: true }))
    .map((v) => ({ value: v.id, label: v.unit_number })),
);

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
        <FilterSelect v-model="f.vehicleIds.value" :options="truckOptions" label="Unit" multiple />
        <FilterSelect
          v-model="mine"
          label="Owner"
          :options="[
            { value: '', label: 'Anyone' },
            { value: 'me', label: 'Assigned to me' },
          ]"
        />
      </template>
      <template #actions>
        <ExportButton
          :href="exportTarget.href"
          :filename="exportTarget.filename"
          :scope="exportTarget.scope"
          :disabled="!rows.length"
        />
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
