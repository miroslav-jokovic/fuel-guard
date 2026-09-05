<script setup lang="ts">
/**
 * The Fuel Log's `Declines` tab — declined fuel-card attempts from the EFS Reject reports
 * (FUEL-C2, D-FUI1).
 *
 * ── WHY IT IS A TAB OF THE FUEL LOG AND NOT A PAGE ──────────────────────────────────────────────
 * This was `/rejections`, and it answers a question the fills list cannot: what was ATTEMPTED and
 * refused. That is the same truck, the same card and the same week as the fill above it, and reading
 * the two required leaving one page for another with a different window control and a different idea
 * of what a day is. Under one window and one truck filter, "what did 654 do in August" is one screen.
 *
 * Everything below is the old page's, moved rather than rewritten: the Central-time rendering, the
 * driver-source note, the card-assignment drawer, the decline drill-down and the rescore action.
 *
 * ⚠ **Gated on `canView("fuel")` by the shell.** `/rejections` was catalogued `section("fuel")` and
 * `/fuel-log` is `always`; a merge without the gate would hand a fraud signal to a recruiter.
 */
import { ref, computed, watch } from "vue";
import { useDeclinedTransactions, useEfsFacets, useEfsRowCoverage, EFS_PAGE_SIZE, type EfsFilters } from "./useEfsData";
import type { DeclinedTransactionRow } from "@silvicom/shared";
import { rejectDateTime, stationLocalNote } from "@/lib/stationTime";
import { useVehiclesQuery } from "@/composables/useVehicles";
import DateRangeFilter from "@/components/DateRangeFilter.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import FilterBar, { type FilterChip } from "@/components/ui/FilterBar.vue";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import FeedFreshnessLine from "@/components/FeedFreshnessLine.vue";
import RowCoverageLine from "@/components/RowCoverageLine.vue";
import { AppButton as BaseButton } from "@silvicom/ui";
import { AppTable } from "@silvicom/ui";
import TablePagination from "@/components/TablePagination.vue";
import SlideOver from "@/components/SlideOver.vue";
import { useUrlSort, SORT_DIRECTIONS } from "@/composables/useUrlSort";
import { apiFetch } from "@/lib/api";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import { BADGE_BASE, suspicionTone, toneClass } from "@/lib/badges";
import { useCardAssignments, maskCardRef } from "@/composables/useCardAssignments";
import { useUnitOptions } from "./unitFilter";
import type { FuelLogSharedFilters } from "./useFuelLogFilters";

const props = defineProps<{ shared: FuelLogSharedFilters }>();

const session = useSessionStore();
const toast = useToastStore();

/**
 * The facets this tab alone owns, each its own URL parameter (FUEL-C3, D-FUI8). Not shared with the
 * other two tabs, and cleared when the tab changes, for the reason in `useFuelLogFilters`' header:
 * `driver` here is a NAME derived from the card while the fills tab's is a driver ID, and `sort`
 * names a column of `declined_transactions` that `fuel_transactions` does not have.
 *
 * `risk` and `error` are shorter than the field names they set, because these are the parameters a
 * reader pastes into a ticket — `?risk=alert&error=51` says what it does.
 */
const suspicion = props.shared.facet("risk", ["alert", "review", "clear"]);
const search = props.shared.facet("search");
const errorCode = props.shared.facet("error");
const stateF = props.shared.facet("state");
const driver = props.shared.facet("driver");
const policy = props.shared.facet("policy");

/**
 * ⚠ The sortable columns, as the vocabulary a forwarded link is checked against. Every other facet
 * here fails safe on an unknown value — an empty list, with the chip saying why. A sort key does
 * not: it reaches PostgREST's `.order()`, so an unrecognised one is an error state rather than an
 * empty one. `fueled_at` off the fills tab is exactly the value this refuses.
 */
const SORTABLE = ["unit", "suspicion_level", "declined_at", "driver_name", "state", "error_code"] as const;
const sortKey = props.shared.facet("sort", SORTABLE);
const sortDir = props.shared.facet("dir", SORT_DIRECTIONS);
const { sort, onSort } = useUrlSort(sortKey, sortDir);

const filters = computed<EfsFilters>(() => ({
  suspicion: suspicion.value || undefined,
  search: search.value || undefined,
  errorCode: errorCode.value || undefined,
  state: stateF.value || undefined,
  driver: driver.value || undefined,
  policy: policy.value || undefined,
  sortKey: sortKey.value || undefined,
  sortDir: sortDir.value === "desc" ? "desc" : "asc",
  units: props.shared.units.value,
  from: props.shared.from.value,
  to: props.shared.to.value,
}));

const page = ref(1);
watch(filters, () => (page.value = 1), { deep: true });

const { data, isLoading, isError, error, refetch, isFetching } = useDeclinedTransactions(filters, page);

const { data: vehicles } = useVehiclesQuery();
const unitOptions = useUnitOptions();

const { data: facets } = useEfsFacets();

// FUEL-T5. `declined_transactions.vehicle_id` already IS the attribution fact — see the composable's
// header for why this needed no migration and the plan expected one.
const { data: coverage } = useEfsRowCoverage("rejections", filters);

// WP2 — read-only card→truck assignments (the ground truth the decline scorer uses).
const cardsOpen = ref(false);
const { data: cardRows } = useCardAssignments();
const unitByVehicleId = computed(() => new Map((vehicles.value ?? []).map((v) => [v.id, v.unit_number])));
const cardList = computed(() =>
  (cardRows.value ?? []).map((c) => ({
    id: c.id,
    card: maskCardRef(c.card_ref, c.card_last4),
    unit: c.vehicle_id ? (unitByVehicleId.value.get(c.vehicle_id) ?? "?") : "—",
    source: c.assignment_source ?? "manual",
    updated: c.updated_at,
  })),
);

/** The shared half, proxied for the controls that write it back to the URL. */
const unit = computed<string[]>({
  get: () => props.shared.units.value,
  set: (v) => props.shared.setUnits(v),
});
const setFrom = (v: string | undefined) => props.shared.setFrom(v);
const setTo = (v: string | undefined) => props.shared.setTo(v);

const suspicionOptions = [
  { value: "", label: "All risk levels" },
  { value: "alert", label: "Alert" },
  { value: "review", label: "Review" },
  { value: "clear", label: "Clear" },
];
const withAll = (label: string, vals: string[] = []) => [
  { value: "", label },
  ...vals.map((v) => ({ value: v, label: v })),
];
const errorOptions = computed(() => [
  { value: "", label: "All error codes" },
  ...(facets.value?.rejErrorCodes ?? []).map((e) => ({ value: e.code, label: e.label })),
]);
const stateOptions = computed(() => withAll("All states", facets.value?.rejStates));
const driverOptions = computed(() => withAll("All drivers", facets.value?.rejDrivers));
const policyOptions = computed(() => withAll("All policies", facets.value?.rejPolicies));

// Chips surface only the popover (secondary) filters — the inline triggers
// already display their own active value.
const chips = computed<FilterChip[]>(() => {
  const out: FilterChip[] = [];
  if (stateF.value) out.push({ key: "state", label: "State", value: stateF.value });
  if (driver.value) out.push({ key: "driver", label: "Driver", value: driver.value });
  if (policy.value) out.push({ key: "policy", label: "Policy", value: policy.value });
  return out;
});
const moreCount = computed(
  () => (stateF.value ? 1 : 0) + (driver.value ? 1 : 0) + (policy.value ? 1 : 0),
);
function removeChip(key: string) {
  if (key === "state") stateF.value = "";
  if (key === "driver") driver.value = "";
  if (key === "policy") policy.value = "";
}
/**
 * Clears BOTH halves: "Clear filters" means the screen, not this component's share of it. The sort
 * stays — it is how the list is ordered, not how it is narrowed. Every assignment is one `set` in
 * the same tick, which `useQueryState`'s buffer coalesces into one navigation.
 */
function clearAll() {
  suspicion.value = "";
  search.value = "";
  errorCode.value = "";
  stateF.value = "";
  driver.value = "";
  policy.value = "";
  props.shared.clear();
}

const rows = computed(() => data.value?.rows ?? []);
const total = computed(() => data.value?.total ?? 0);
// Show declined times in the station's local timezone (matches the EFS report), not the browser's.
// 2026-08: declines render in the zone the EFS reject report PRINTS (Central) so the page matches
// the printout — the same principle the source-records tab follows with its faithful tran_time column.
const fmt = (iso: string | null, _state: string | null) => rejectDateTime(iso);

// The EFS reject feed carries NO driver — verified against the live getTranRejects operation on
// 2026-08-12: 110 records, ten fields, no driverName/driverId. So a name in this column is DERIVED
// from the card (migration 0182 records which source), and the UI has to say so: a decline is
// exactly the case where the card may not be with its assigned driver, and that gap is the fraud
// signal this tab exists to surface. An unmarked name would read as evidence of presence.
const DRIVER_SOURCE_NOTE: Record<string, string> = {
  efs_report: "As printed on the uploaded EFS reject report.",
  card_mirror: "The driver this card is assigned to in EFS. NOT proof this person was at the pump.",
  posted_history: "Derived from approved fills on this same card. NOT proof this person was at the pump.",
};
const driverNote = (row: DeclinedTransactionRow): string =>
  DRIVER_SOURCE_NOTE[row.driver_name_source ?? ""] ?? "";

// Row drill-down: click a decline to inspect its full details + why it was flagged.
const selectedRow = ref<DeclinedTransactionRow | null>(null);

const rescoring = ref(false);
async function rescore() {
  rescoring.value = true;
  const res = await apiFetch("/api/transactions/rescore-declined", { method: "POST" });
  rescoring.value = false;
  if (res.ok) toast.success("Rescoring started", "Checking each declined attempt against Samsara — refresh in a minute.");
  else if (res.status === 409) toast.info("Already running", "A rescore is already in progress — refresh in a moment.");
  else toast.error("Could not start rescore", res.error?.message);
}

const columns: DataTableColumn[] = [
  {
    key: "unit",
    label: "Unit",
    sortable: true,
    width: "sm",
  },
  { key: "suspicion_level", label: "Risk", sortable: true, width: "sm" },
  { key: "declined_at", label: "Date / Time", sortable: true, width: "lg", cellClass: "text-ink-secondary" },
  { key: "card_ref", label: "Card #", width: "md", cellClass: "text-ink-secondary" },
  { key: "invoice", label: "Invoice", width: "sm", cellClass: "text-ink-secondary" },
  { key: "driver_name", label: "Driver", sortable: true, width: "lg", cellClass: "text-ink-secondary" },
  { key: "location_text", label: "Location", width: "xl", cellClass: "text-ink-secondary" },
  { key: "city", label: "City", width: "md", cellClass: "text-ink-secondary" },
  { key: "state", label: "State", sortable: true, width: "xs", cellClass: "text-ink-secondary" },
  { key: "error_code", label: "Error", sortable: true, width: "sm" },
  { key: "error_description", label: "Description", width: "xl", cellClass: "max-w-md truncate text-ink-secondary" },
  { key: "policy_name", label: "Policy", width: "md", cellClass: "text-ink-secondary" },
];
</script>

<template>
  <div class="space-y-6">
    <!-- A7 / FUEL-T5. These rows are EFS's own, so this tab cannot show a wrong one — only a
         missing one, and a stopped poller reads exactly like a quiet week. Above the filters, where
         a reader meets it before drawing a conclusion from a short list. -->
    <FeedFreshnessLine feed="rejected" />

    <!-- FUEL-T5, and it matters more here than anywhere else in the section: one decline in five
         resolves to no truck (696 of 3,445, measured 2026-09-02) on the tab whose whole job is a
         fraud signal. A reader scoping this to a unit was seeing four fifths of it, unannounced. -->
    <RowCoverageLine :coverage="coverage" />

    <FilterBar
      v-model:search="search"
      search-placeholder="Search unit, driver, location, error…"
      :count="total"
      count-label="declines"
      :chips="chips"
      :more-count="moreCount"
      @remove="removeChip"
      @clear-all="clearAll"
    >
      <template #filters>
        <FilterSelect v-model="suspicion" label="Risk" :options="suspicionOptions" />
        <FilterSelect v-model="unit" label="Unit" :options="unitOptions" multiple />
        <FilterSelect v-model="errorCode" label="Error" :options="errorOptions" />
        <DateRangeFilter :from="shared.from.value" :to="shared.to.value" @update:from="setFrom" @update:to="setTo" />
      </template>
      <template #more>
        <FilterSelect v-model="stateF" label="State" :options="stateOptions" block />
        <FilterSelect v-model="driver" label="Driver" :options="driverOptions" block />
        <FilterSelect v-model="policy" label="Policy" :options="policyOptions" block />
      </template>
      <template #actions>
        <BaseButton
          size="sm"
          variant="secondary"
          title="Card → truck assignments learned from fill history (what the decline scorer checks pump units against)"
          @click="cardsOpen = true"
        >
          Cards{{ cardList.length ? ` (${cardList.length})` : "" }}
        </BaseButton>
        <BaseButton
          v-if="session.can('fuel')"
          size="sm"
          :disabled="rescoring"
          title="Check each declined attempt against Samsara + card patterns"
          @click="rescore"
        >
          {{ rescoring ? "Rescoring…" : "Rescore" }}
        </BaseButton>
      </template>
    </FilterBar>

    <!-- D-FUI11: one date contract, and each control says which day it means. Before FUEL-T1
         the section had four answers to “what is a day” and no surface admitted to having one. -->
    <p class="-mt-3 text-xs text-ink-tertiary">Dates are the decline day in Central time, which is how EFS records a reject whatever the
        station’s own zone is.</p>

    <DataTable
      :columns="columns"
      :rows="rows"
      row-key="id"
      :loading="isLoading"
      :error="isError ? (error instanceof Error ? error.message : 'Failed to load rejections') : null"
      :retrying="isFetching"
      :sort="sort"
      pin-first-column
      :row-class="() => 'cursor-pointer'"
      empty-text="No declined transactions match — adjust the filters, or use Backfill EFS reports in the page header."
      @sort="onSort"
      @retry="refetch"
      @row-click="selectedRow = $event"
    >
      <template #cell-suspicion_level="{ row }">
        <span
          v-if="row.suspicion_level && row.suspicion_level !== 'clear'"
          :class="[BADGE_BASE, suspicionTone(row.suspicion_level)]"
          :title="(row.suspicion_reasons ?? []).map((r) => r.detail).join(' · ')"
          >{{ row.suspicion_level }}</span
        >
        <span v-else-if="row.suspicion_level === 'clear'" class="text-xs text-ink-tertiary">Clear</span>
        <span v-else class="text-xs text-ink-tertiary">—</span>
      </template>
      <template #cell-declined_at="{ row }">{{ fmt(row.declined_at, row.state) }}</template>
      <template #cell-driver_name="{ row }">
        <span v-if="row.driver_name" :title="driverNote(row)">{{ row.driver_name }}</span>
        <span v-else class="text-xs text-ink-tertiary">—</span>
      </template>
      <template #cell-error_code="{ row }">
        <span :class="[BADGE_BASE, toneClass('danger')]">{{ row.error_code }}</span>
      </template>
      <template #cell-error_description="{ row }">
        <span :title="row.error_description ?? ''">{{ row.error_description }}</span>
      </template>
      <template #cell-policy_name="{ row }">{{ row.policy_name?.trim() }}</template>
      <template #footer>
        <TablePagination
          :page="page"
          :page-size="EFS_PAGE_SIZE"
          :total="total"
          :loading="isFetching"
          @update:page="page = $event"
        />
      </template>
    </DataTable>

    <!-- Card → truck assignments (read-only; learned from fill history, manual rows authoritative) -->
    <SlideOver :open="cardsOpen" title="Card assignments" @close="cardsOpen = false">
      <div class="space-y-3 text-sm">
        <p class="text-xs text-ink-muted">
          The card → truck assignments the decline scorer checks pump units against. Learned automatically
          from attributed fill history (≥5 fills with a ≥70% majority on one truck); a card that floats
          between trucks gets no assignment. Manual assignments are never overwritten.
        </p>
        <p v-if="!cardList.length" class="text-ink-tertiary">
          No assignments learned yet — they appear after enough attributed fill history (or a Rescore).
        </p>
        <AppTable v-else class="w-full text-left text-sm">
          <thead>
            <tr class="text-xs uppercase tracking-wide text-ink-muted">
              <th class="py-1.5 pr-3 font-semibold">Card</th>
              <th class="py-1.5 pr-3 font-semibold">Assigned truck</th>
              <th class="py-1.5 font-semibold">Source</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in cardList" :key="c.id" class="border-t border-edge-subtle">
              <td class="py-1.5 pr-3 font-mono text-ink">{{ c.card }}</td>
              <td class="py-1.5 pr-3 text-ink">{{ c.unit }}</td>
              <td class="py-1.5">
                <span :class="[BADGE_BASE, toneClass(c.source === 'manual' ? 'brand' : 'neutral')]">{{ c.source }}</span>
              </td>
            </tr>
          </tbody>
        </AppTable>
      </div>
    </SlideOver>

    <!-- Decline detail drill-down -->
    <SlideOver :open="!!selectedRow" title="Declined attempt" @close="selectedRow = null">
      <div v-if="selectedRow" class="space-y-5 text-sm">
        <div class="flex items-center justify-between">
          <div>
            <div class="text-lg font-semibold text-ink">Unit {{ selectedRow.unit || "—" }}</div>
            <div class="text-ink-muted">{{ fmt(selectedRow.declined_at, selectedRow.state) }}</div>
            <div v-if="stationLocalNote(selectedRow.declined_at, selectedRow.state)" class="text-xs text-ink-tertiary">
              Station local: {{ stationLocalNote(selectedRow.declined_at, selectedRow.state) }}
            </div>
          </div>
          <span
            v-if="selectedRow.suspicion_level && selectedRow.suspicion_level !== 'clear'"
            :class="[BADGE_BASE, suspicionTone(selectedRow.suspicion_level), 'capitalize']"
            >{{ selectedRow.suspicion_level }}</span
          >
          <span v-else class="text-xs text-ink-tertiary">Clear</span>
        </div>

        <div class="rounded-control bg-danger-50 p-3 ring-1 ring-danger-100">
          <div class="flex items-center gap-2">
            <span :class="[BADGE_BASE, toneClass('danger')]">{{ selectedRow.error_code }}</span>
            <span class="font-medium text-danger-800">{{ selectedRow.error_description }}</span>
          </div>
          <p v-if="selectedRow.policy_name" class="mt-1 text-xs text-danger-700">Policy: {{ selectedRow.policy_name.trim() }}</p>
        </div>

        <div v-if="(selectedRow.suspicion_reasons ?? []).length" class="space-y-2">
          <h4 class="text-xs font-semibold uppercase tracking-wide text-ink-muted">Why it was flagged</h4>
          <ul class="space-y-1.5">
            <li v-for="(r, i) in selectedRow.suspicion_reasons ?? []" :key="i" class="flex items-start gap-2 text-ink-secondary">
              <span class="mt-1.5 size-1.5 shrink-0 rounded-full bg-warning-400" aria-hidden="true" />
              <span>{{ r.detail }}</span>
            </li>
          </ul>
        </div>

        <dl class="grid grid-cols-2 gap-x-4 gap-y-3">
          <div class="col-span-2">
            <dt class="text-xs text-ink-tertiary">Driver</dt>
            <dd class="text-ink">{{ selectedRow.driver_name || "—" }}</dd>
            <dd v-if="selectedRow.driver_name && driverNote(selectedRow)" class="mt-0.5 text-xs text-ink-tertiary">
              {{ driverNote(selectedRow) }}
            </dd>
            <dd v-else-if="!selectedRow.driver_name" class="mt-0.5 text-xs text-ink-tertiary">
              The EFS reject feed does not report a driver, and this card could not be matched to one.
            </dd>
          </div>
          <div><dt class="text-xs text-ink-tertiary">Card #</dt><dd class="text-ink">{{ selectedRow.card_ref || "—" }}</dd></div>
          <div><dt class="text-xs text-ink-tertiary">Invoice</dt><dd class="text-ink">{{ selectedRow.invoice || "—" }}</dd></div>
          <div><dt class="text-xs text-ink-tertiary">Location</dt><dd class="text-ink">{{ selectedRow.location_text || "—" }}</dd></div>
          <div><dt class="text-xs text-ink-tertiary">City</dt><dd class="text-ink">{{ selectedRow.city || "—" }}</dd></div>
          <div><dt class="text-xs text-ink-tertiary">State</dt><dd class="text-ink">{{ selectedRow.state || "—" }}</dd></div>
          <div><dt class="text-xs text-ink-tertiary">Import id</dt><dd class="font-mono text-xs text-ink">{{ selectedRow.import_id || "—" }}</dd></div>
        </dl>
      </div>
    </SlideOver>
  </div>
</template>
