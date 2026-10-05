<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter, RouterLink } from "vue-router";
import { AppButton as BaseButton, AppCallout, AppCard as BaseCard, AppIcon } from "@silvicom/ui";
import { ChevronDownIcon, ChevronRightIcon } from "@silvicom/ui/icons";
import { STATE_NAMES, type IftaJurisdictionTruck } from "@silvicom/shared";
import PageHeader from "@/components/ui/PageHeader.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import StatCard from "@/components/ui/StatCard.vue";
import TablePagination from "@/components/TablePagination.vue";
import { useOpens } from "@/composables/useOpens";
import { formatDate } from "@/lib/format";
import { sortRows, toggleSort, type SortState } from "@/lib/sort";
import {
  parseQuarterKey, quarterKey, quarterLabel, selectableQuarters, useIftaJurisdictionQuery,
  type IftaQuarter,
} from "@/features/ifta/useIftaPeriod";
import { gal, pct1, usd, usd3 } from "@/features/reconcile/format";

/**
 * One row of the IFTA ledger, opened: every truck that drove in this jurisdiction during the quarter,
 * how far it drove there, and the fuel it bought there — each truck's fills one click away.
 *
 * ── WHY A PAGE AND NOT A DRAWER ON THE LEDGER ───────────────────────────────────────────────────
 * The ledger exists to be sent to somebody (its quarter lives in the URL for that reason), and the
 * question this answers — "which trucks make up Texas's 564,170 miles and 116,000 gallons" — is the
 * one the person it is sent to asks next. A drawer has no address, so the answer could not be
 * forwarded with the question.
 *
 * Both halves are the ledger row's own inputs, split by truck: Samsara's monthly jurisdiction miles
 * and the tractor fills bought in the jurisdiction on their station-local date. So the totals at the
 * top of this page ARE that row's taxable miles and gallons bought — fills no truck is attached to
 * included, on a row of their own, because they are in the row's total too.
 */
const route = useRoute();
const router = useRouter();
const opens = useOpens();

const code = computed(() => String(route.params.jurisdiction ?? "").toUpperCase());
const name = computed(() => STATE_NAMES[code.value] ?? code.value);

const NOW = new Date();
const quarters = selectableQuarters(NOW);
const quarter = computed<IftaQuarter>(() => parseQuarterKey(route.query.q as string) ?? quarters[0]!);
const quarterOptions = quarters.map((q) => ({ value: quarterKey(q), label: quarterLabel(q) }));
const selectedKey = computed<string>({
  get: () => quarterKey(quarter.value),
  set: (v) => void router.replace({ query: { ...route.query, q: v } }),
});

const { data, isLoading, isFetching, isError, error, refetch } = useIftaJurisdictionQuery(quarter, code);

/** The vehicle page is an `equipment` screen; an accountant who reads IFTA may not hold it. */
const vehicleOpens = computed(() => opens("/vehicles/any"));

/** Fills with no truck have no vehicle id, so their row is keyed by name. */
const UNASSIGNED = "unassigned";
const keyOf = (t: IftaJurisdictionTruck) => t.vehicleId ?? UNASSIGNED;
const truckLabel = (t: IftaJurisdictionTruck) =>
  t.vehicleId == null ? "Not assigned to a truck" : (t.unitNumber ?? "No unit number");

/**
 * Which trucks the table lists, from `?show=`. The resting view (`""`) is the trucks that BOUGHT fuel
 * here — the owner's ruling of 2026-10-05, because the question this page is opened with is "where
 * did our fuel go". Resting on `""` rather than `"fuelled"` is not cosmetic: `FilterSelect` reads any
 * non-empty value as an applied filter and draws it as a chip with a clear button.
 *
 * ⚠ A truck that drove here and bought nothing is not noise — its miles are what make this
 * jurisdiction OWED tax. So it is one choice away rather than gone, the cards above keep the whole
 * jurisdiction's figures, and the count says "N of M" whenever the list is narrower than the cards.
 */
type Show = "" | "drove" | "all";
const SHOW_OPTIONS: { value: Show; label: string }[] = [
  { value: "", label: "Bought fuel here" },
  { value: "drove", label: "Drove here, bought none" },
  { value: "all", label: "All trucks" },
];
const show = computed<Show>({
  get: () => (["drove", "all"].includes(String(route.query.show)) ? (route.query.show as Show) : ""),
  set: (v) => void router.replace({ query: { ...route.query, show: v || undefined } }),
});
const search = computed<string>({
  get: () => String(route.query.search ?? ""),
  set: (v) => void router.replace({ query: { ...route.query, search: v.trim() ? v : undefined } }),
});
const shows = (t: IftaJurisdictionTruck): boolean =>
  show.value === "all" || (show.value === "drove" ? t.fills.length === 0 : t.fills.length > 0);
const matches = (t: IftaJurisdictionTruck): boolean => {
  const q = search.value.trim().toLowerCase();
  return !q || truckLabel(t).toLowerCase().includes(q);
};
const activeFilterCount = computed(() => (show.value ? 1 : 0) + (search.value.trim() ? 1 : 0));
const resetFilters = () => void router.replace({ query: { ...route.query, show: undefined, search: undefined } });

const sort = ref<SortState>({ key: null, dir: "asc" });
const byKey = computed(() => new Map((data.value?.trucks ?? []).map((t) => [keyOf(t), t])));
const visible = computed(() => (data.value?.trucks ?? []).filter((t) => shows(t) && matches(t)));
const rows = computed(() =>
  sortRows(
    visible.value.map((t) => ({
      id: keyOf(t),
      unit: truckLabel(t),
      taxableMiles: t.taxableMiles,
      totalMiles: t.totalMiles,
      share: t.share,
      months: t.months,
      gallonsBought: t.gallonsBought,
      fillCount: t.fills.length,
      spent: t.spent,
    })),
    sort.value,
  ),
);
const cols: DataTableColumn[] = [
  { key: "unit", label: "Truck", width: "md", sortable: true },
  { key: "taxableMiles", label: "Taxable miles", numeric: true, width: "sm", sortable: true },
  { key: "totalMiles", label: "Total miles", numeric: true, width: "sm", sortable: true },
  { key: "share", label: "Share of miles", numeric: true, width: "sm", sortable: true },
  { key: "months", label: "Months here", numeric: true, width: "sm", sortable: true },
  { key: "gallonsBought", label: "Gallons bought", numeric: true, width: "sm", sortable: true },
  { key: "fillCount", label: "Fills", numeric: true, width: "xs", sortable: true },
  { key: "spent", label: "Spent", numeric: true, width: "sm", sortable: true },
];
/** Trucks, not rows: the fills with no truck sit on a row of their own and are not a truck. */
const truckCount = computed(() => (data.value?.trucks ?? []).filter((t) => t.vehicleId != null).length);
const listedTrucks = computed(() => visible.value.filter((t) => t.vehicleId != null).length);
const onSort = (key: string) => (sort.value = toggleSort(sort.value, key));

/** Client-side pages over the filtered list — a jurisdiction-quarter is at most a few hundred trucks. */
const PAGE_SIZE = 25;
const page = ref(1);
watch([rows, sort], () => (page.value = 1));
const paged = computed(() => rows.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));

/** An empty list says which of the two it is: nothing here at all, or nothing this filter keeps. */
const emptyText = computed(() => {
  const where = `${name.value} in ${quarterLabel(quarter.value)}`;
  if (!data.value?.trucks.length) return `No truck drove or bought fuel in ${where}.`;
  if (search.value.trim()) return `No truck matching "${search.value.trim()}". Clear the search to see them all.`;
  if (show.value === "") return `No truck bought fuel in ${where}. Choose "All trucks" to see the ones that drove there.`;
  if (show.value === "drove") return `Every truck that drove in ${where} also bought fuel there.`;
  return `No truck drove or bought fuel in ${where}.`;
});

/** A truck's fills open under its row — the mouse clicks the row, the keyboard the chevron. */
const expanded = ref(new Set<string>());
const hasFills = (id: string) => (byKey.value.get(id)?.fills.length ?? 0) > 0;
function toggle(row: Record<string, unknown>) {
  const id = String(row.id);
  if (!hasFills(id)) return;
  const next = new Set(expanded.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expanded.value = next;
}
const fillCols: DataTableColumn[] = [
  { key: "date", label: "Date", width: "sm" },
  { key: "location", label: "Where", width: "lg" },
  { key: "gallons", label: "Gallons", numeric: true, width: "sm" },
  { key: "price", label: "Price / gal", numeric: true, width: "sm" },
  { key: "total", label: "Total", numeric: true, width: "sm" },
];
/**
 * A receipt keyed in McLeod (IP6) is a row of its own kind: it has a date, a state and gallons, and
 * McLeod holds no station, price or time for it — so those cells stay empty rather than invented.
 */
const RECEIPT = "Receipt keyed in McLeod";
const fillRows = (id: string) =>
  (byKey.value.get(id)?.fills ?? []).map((f) => ({
    id: f.id,
    date: formatDate(f.businessDate ?? f.fueledAt),
    location: f.source === "mcleod_receipt"
      ? [`${RECEIPT} · ${code.value}`, f.location].filter(Boolean).join(" · ")
      : f.location,
    gallons: gal(f.gallons),
    price: f.pricePerGal == null ? null : usd3(f.pricePerGal),
    total: f.totalCost == null ? null : usd(f.totalCost),
  }));

/** "in 684 fills", and the receipts beside them when there are any — both inside "Gallons bought". */
const boughtSub = computed(() => {
  const d = data.value;
  if (!d) return "";
  const fills = `in ${d.fillCount.toLocaleString("en-US")} fill${d.fillCount === 1 ? "" : "s"}`;
  if (!d.receiptCount) return fills;
  const n = d.receiptCount.toLocaleString("en-US");
  return `${fills} + ${n} receipt${d.receiptCount === 1 ? "" : "s"} keyed in McLeod (${gal(d.receiptGallons)} gal)`;
});
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      :title="`IFTA · ${name}`"
      :description="`Every truck that drove or bought fuel in ${name} in ${quarterLabel(quarter)}: its miles there and its fills there.`"
    />

    <FilterBar
      v-model:search="search"
      search-placeholder="Search truck…"
      :count="listedTrucks"
      count-label="trucks"
    >
      <template #filters>
        <FilterSelect v-model="selectedKey" :options="quarterOptions" label="Quarter" />
        <FilterSelect v-model="show" :options="SHOW_OPTIONS" label="Show" />
      </template>
      <template #actions>
        <BaseButton v-if="activeFilterCount" variant="ghost" size="sm" @click="resetFilters">Clear filters</BaseButton>
      </template>
    </FilterBar>

    <AppCallout v-if="isError" tone="danger">
      Couldn't load {{ name }}: {{ error instanceof Error ? error.message : "unknown error" }}
    </AppCallout>

    <template v-else>
      <div v-if="data" class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Taxable miles" :value="data.taxableMiles.toLocaleString('en-US')" :sub="`${data.totalMiles.toLocaleString('en-US')} total, incl. toll and off-highway`" />
        <StatCard label="Gallons bought" :value="gal(data.gallonsBought)" :sub="boughtSub" />
        <StatCard label="Spent here" :value="usd(data.spent)" sub="tractor diesel, as billed" />
        <StatCard label="Trucks" :value="truckCount.toLocaleString('en-US')" :sub="`drove or fuelled in ${name}`" />
      </div>

      <p v-if="data && listedTrucks !== truckCount" class="text-xs text-ink-tertiary" data-testid="narrower">
        Listing {{ listedTrucks.toLocaleString("en-US") }} of {{ truckCount.toLocaleString("en-US") }} trucks. The
        figures above are the whole of {{ name }} for the quarter.
      </p>

      <BaseCard padding="none">
        <DataTable
          :columns="cols"
          :rows="paged"
          row-key="id"
          :loading="isLoading || isFetching"
          :sort="sort"
          :expanded="expanded"
          :empty-text="emptyText"
          @sort="onSort"
          @retry="() => refetch()"
          @row-click="toggle"
        >
          <template #cell-unit="{ row }">
            <span class="flex items-center gap-2">
              <BaseButton
                v-if="hasFills(String(row.id))"
                variant="ghost"
                size="sm"
                :aria-expanded="expanded.has(String(row.id))"
                :aria-label="`${expanded.has(String(row.id)) ? 'Hide' : 'Show'} the fills bought in ${name} by ${row.unit}`"
                @click.stop="toggle(row)"
              >
                <AppIcon :icon="expanded.has(String(row.id)) ? ChevronDownIcon : ChevronRightIcon" class="size-4" aria-hidden="true" />
              </BaseButton>
              <span v-else class="inline-block w-8" aria-hidden="true" />
              <RouterLink
                v-if="vehicleOpens && row.id !== UNASSIGNED"
                :to="`/vehicles/${row.id}`"
                class="font-medium text-brand-700 hover:underline"
                @click.stop
              >{{ row.unit }}</RouterLink>
              <span v-else class="font-medium text-ink">{{ row.unit }}</span>
            </span>
          </template>
          <template #cell-taxableMiles="{ row }">{{ Number(row.taxableMiles).toLocaleString("en-US") }}</template>
          <template #cell-totalMiles="{ row }">{{ Number(row.totalMiles).toLocaleString("en-US") }}</template>
          <template #cell-share="{ row }">{{ row.share == null ? "—" : pct1(Number(row.share)) }}</template>
          <template #cell-months="{ row }">{{ row.months ? `${row.months} of 3` : "—" }}</template>
          <template #cell-gallonsBought="{ row }">{{ Number(row.gallonsBought) ? gal(Number(row.gallonsBought)) : "—" }}</template>
          <template #cell-fillCount="{ row }">{{ row.fillCount || "—" }}</template>
          <template #cell-spent="{ row }">{{ Number(row.spent) ? usd(Number(row.spent)) : "—" }}</template>
          <template #expanded="{ row }">
            <DataTable
              embedded
              dense
              :columns="fillCols"
              :rows="fillRows(String(row.id))"
              row-key="id"
              :data-testid="`fills-${row.id}`"
            />
          </template>
          <template #footer>
            <TablePagination :page="page" :page-size="PAGE_SIZE" :total="rows.length" @update:page="page = $event" />
          </template>
        </DataTable>
      </BaseCard>

      <p class="text-xs text-ink-tertiary">
        Miles are Samsara's monthly jurisdiction report for each truck, added up over the quarter. Fills are
        tractor diesel bought at {{ name }} stations, dated in the station's own time zone. Receipts keyed in
        McLeod are the cash and drivers'-own-card fuel the office types in after the quarter closes; one that
        matches a card fill (same truck, day and gallons) is counted once<template v-if="data?.receiptDuplicates">
        ({{ data.receiptDuplicates }} here)</template>. All of it is what the IFTA page's {{ name }} row adds up
        across trucks, so the totals above match that row.
      </p>
    </template>
  </div>
</template>
