<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import { AppIcon, AppButton as BaseButton, AppCheckbox as BaseCheckbox } from "@fuelguard/ui";
import { ArrowDownTrayIcon, ChevronDownIcon, ChevronRightIcon } from "@fuelguard/ui/icons";
import { DQ_EXPORT_MAX_DRIVERS, type DqAttentionItem, type DqItemState } from "@fuelguard/shared";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import TablePagination from "@/components/TablePagination.vue";
import KebabMenu from "@/components/KebabMenu.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { formatDate } from "@/lib/format";
import { sortRows, toggleSort, type SortState } from "@/lib/sort";
import { useComplianceOverviewQuery } from "@/composables/useCompliance";
import { useToastStore } from "@/stores/toast";
import { useSessionStore } from "@/stores/session";

/**
 * The fleet qualification table — ONE ROW PER DRIVER.
 *
 * The previous queue rendered one row per driver × requirement, so an unseeded ten-driver fleet was
 * nine pages of the same names repeating — thousands of "items" where the real unit of work is a
 * driver whose file needs attention. Here the driver is the row; the requirements are the detail,
 * one click away (expand) or on the file page. Worst file first, ranked by the same shared states
 * the file page computes, so the two surfaces cannot disagree.
 */
const PAGE_SIZE = 20;

const props = defineProps<{
  /** True while the page's binder request is in flight — disables the build button. */
  building?: boolean;
}>();
const emit = defineEmits<{ "build-binder": [driverIds: string[], includeRestricted: boolean] }>();

const toast = useToastStore();
const session = useSessionStore();
const query = useComplianceOverviewQuery();

/** Phase G (D-DQ15): the default binder carries no §382.401/§391.53 evidence. Only a privileged
 *  role sees the opt-in, and the ask is recorded on the export ledger server-side. */
const includeRestricted = ref(false);

/**
 * Binder selection lives with the table it selects from (the old design hid it on a different tab
 * than the queue, and the Exports empty state had to explain where to look). The page only runs
 * the request; the cap and the bar are the table's concern.
 */
const selected = ref<Set<string>>(new Set());
const atCap = computed(() => selected.value.size >= DQ_EXPORT_MAX_DRIVERS);
function setSelected(next: Set<string>): void {
  if (next.size <= DQ_EXPORT_MAX_DRIVERS) {
    selected.value = next;
    return;
  }
  selected.value = new Set([...next].slice(0, DQ_EXPORT_MAX_DRIVERS));
  toast.warning(
    "Binder limit reached",
    `A binder can contain up to ${DQ_EXPORT_MAX_DRIVERS} drivers. Build this binder, then select the remaining drivers.`,
  );
}
function buildBinder(): void {
  if (selected.value.size === 0) return;
  emit("build-binder", [...selected.value], session.restrictedAccess && includeRestricted.value);
  selected.value = new Set();
  includeRestricted.value = false;
}

const search = ref("");
// v-models so the page's attention strip (C5) can drive the SAME filters — one filter model, the
// tiles are just another way to set it.
const stateFilter = defineModel<string>("stateFilter", { default: "" });
const dueFilter = defineModel<string>("dueFilter", { default: "" });
const page = ref(1);
const sort = ref<SortState>({ key: null, dir: "asc" });
const expanded = ref<Set<string>>(new Set());

interface FleetRow {
  id: string;
  driver_name: string;
  driver_status: string;
  state: "not_started" | "incomplete" | "complete";
  counts: Record<DqItemState, number>;
  attention: DqAttentionItem[];
  /** Sort rank: the file's worst state. Expired files first, complete files last. */
  worst: number;
  /** Days until the most urgent dated item — negative when overdue, null when nothing is dated. */
  soonest: number | null;
}

const WORST_RANK = { expired: 0, missing: 1, expiring: 2, none: 3 } as const;

const all = computed<FleetRow[]>(() =>
  (query.data.value?.drivers ?? []).map((d) => {
    const dated = d.attention.filter((a) => a.daysRemaining !== null);
    return {
      id: d.driver_id,
      driver_name: d.driver_name,
      driver_status: d.driver_status,
      state: d.state,
      counts: d.counts,
      attention: d.attention,
      worst:
        d.counts.expired > 0
          ? WORST_RANK.expired
          : d.counts.missing > 0
            ? WORST_RANK.missing
            : d.counts.expiring > 0
              ? WORST_RANK.expiring
              : WORST_RANK.none,
      soonest: dated.length ? Math.min(...dated.map((a) => a.daysRemaining as number)) : null,
    };
  }),
);

const stateOptions = [
  { value: "", label: "All drivers" },
  { value: "attention", label: "Needs attention" },
  { value: "expired", label: "Has expired items" },
  { value: "expiring", label: "Has items due soon" },
  { value: "not_started", label: "File not started" },
  { value: "complete", label: "File complete" },
];
const dueOptions = [
  { value: "", label: "Due any time" },
  { value: "overdue", label: "Overdue" },
  { value: "7", label: "Due in 7 days" },
  { value: "14", label: "Due in 14 days" },
  { value: "30", label: "Due in 30 days" },
];

const filtered = computed(() =>
  all.value.filter((r) => {
    switch (stateFilter.value) {
      case "attention":
        if (r.attention.length === 0) return false;
        break;
      case "expired":
        if (r.counts.expired === 0) return false;
        break;
      case "expiring":
        if (r.counts.expiring === 0) return false;
        break;
      case "not_started":
        if (r.state !== "not_started") return false;
        break;
      case "complete":
        if (r.state !== "complete") return false;
        break;
    }
    if (dueFilter.value === "overdue" && (r.soonest === null || r.soonest >= 0)) return false;
    if (
      (dueFilter.value === "7" || dueFilter.value === "14" || dueFilter.value === "30") &&
      (r.soonest === null || r.soonest > Number(dueFilter.value))
    )
      return false;
    const t = search.value.trim().toLowerCase();
    if (t && !r.driver_name.toLowerCase().includes(t)) return false;
    return true;
  }),
);

/** Default order: worst file first, most urgent date first within a state, then name. */
function bySeverity(a: FleetRow, b: FleetRow): number {
  if (a.worst !== b.worst) return a.worst - b.worst;
  if (a.soonest !== b.soonest) {
    if (a.soonest === null) return 1;
    if (b.soonest === null) return -1;
    return a.soonest - b.soonest;
  }
  return a.driver_name.localeCompare(b.driver_name);
}

const sorted = computed(() =>
  sort.value.key
    ? sortRows(filtered.value, sort.value, (row, key) => row[key as keyof FleetRow] as never)
    : [...filtered.value].sort(bySeverity),
);
const pageRows = computed(() =>
  sorted.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE),
);
watch([search, stateFilter, dueFilter], () => (page.value = 1));

function toggleExpand(id: string): void {
  const next = new Set(expanded.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expanded.value = next;
}

const STATE_TONE: Record<DqItemState, string> = {
  current: "success",
  expiring: "warning",
  expired: "danger",
  missing: "neutral",
};
const STATE_LABEL: Record<DqItemState, string> = {
  current: "on file",
  expiring: "due soon",
  expired: "expired",
  missing: "missing",
};

/** The one-glance file summary: "2 expired · 3 missing · 1 due soon", or a single word. */
const fileChips = (row: FleetRow): Array<{ text: string; tone: string }> => {
  const chips: Array<{ text: string; tone: string }> = [];
  if (row.counts.expired > 0) chips.push({ text: `${row.counts.expired} expired`, tone: "danger" });
  if (row.counts.missing > 0) chips.push({ text: `${row.counts.missing} missing`, tone: "neutral" });
  if (row.counts.expiring > 0)
    chips.push({ text: `${row.counts.expiring} due soon`, tone: "warning" });
  return chips;
};

function dueText(days: number | null): string {
  if (days === null) return "";
  if (days < 0) return `${Math.abs(days)} ${Math.abs(days) === 1 ? "day" : "days"} overdue`;
  if (days === 0) return "today";
  return `in ${days} ${days === 1 ? "day" : "days"}`;
}

/** "Medical card — 3 days overdue": the single most urgent thing about this driver. */
function nextDue(row: FleetRow): string | null {
  const first = row.attention.find((a) => a.daysRemaining !== null);
  if (!first) return null;
  return `${first.label} — ${dueText(first.daysRemaining)}`;
}

const columns: DataTableColumn[] = [
  { key: "expand", label: "", headerClass: "w-8" },
  {
    key: "driver_name",
    label: "Driver",
    sortable: true,
    headerClass: "min-w-[13rem]",
    cellClass: "font-medium text-ink",
  },
  { key: "file", label: "Qualification file", headerClass: "min-w-[16rem]" },
  {
    key: "soonest",
    label: "Next due",
    sortable: true,
    headerClass: "min-w-[14rem]",
    cellClass: "text-ink-secondary",
  },
];
function onSort(key: string): void {
  sort.value = toggleSort(sort.value, key);
}
</script>

<template>
  <div class="space-y-6">
    <FilterBar
      v-model:search="search"
      search-placeholder="Search drivers…"
      :count="filtered.length"
      count-label="drivers"
    >
      <template #filters>
        <FilterSelect v-model="stateFilter" label="File status" :options="stateOptions" />
        <FilterSelect v-model="dueFilter" label="Due" :options="dueOptions" />
      </template>
    </FilterBar>

    <p v-if="query.data.value?.truncated" class="text-sm text-warning-700">
      This picture is partial — the fleet has more qualification records than one read returns.
      Narrow the filters, or tell us so we can page it.
    </p>

    <div
      v-if="selected.size > 0"
      class="flex flex-wrap items-center gap-2 rounded-surface bg-brand-50 px-4 py-2.5 ring-1 ring-brand-100"
    >
      <span class="text-sm font-medium text-brand-800"> {{ selected.size }} selected </span>
      <span v-if="atCap" class="text-sm text-brand-800">
        That is the most drivers one binder holds. Send the rest as a second binder.
      </span>
      <div class="ml-auto flex items-center gap-3">
        <BaseCheckbox v-if="session.restrictedAccess" v-model="includeRestricted">
          Include restricted records
        </BaseCheckbox>
        <BaseButton variant="ghost" size="sm" @click="selected = new Set()">Clear</BaseButton>
        <BaseButton variant="primary" size="sm" :disabled="props.building" @click="buildBinder">
          <AppIcon :icon="ArrowDownTrayIcon" class="size-4" aria-hidden="true" />
          {{ props.building ? "Building…" : "Build audit binder" }}
        </BaseButton>
      </div>
    </div>

    <DataTable
      :columns="columns"
      :rows="pageRows"
      row-key="id"
      selectable
      :selected="selected"
      :expanded="expanded"
      :loading="query.isLoading.value"
      :error="
        query.isError.value
          ? (query.error.value?.message ?? 'Could not load the qualification picture.')
          : null
      "
      :retrying="query.isFetching.value"
      :sort="sort"
      :row-class="() => 'cursor-pointer'"
      :empty-text="
        all.length === 0
          ? 'No active drivers yet. Add drivers on the Fleet page, or sync from Samsara.'
          : 'No drivers match these filters.'
      "
      @update:selected="setSelected"
      @sort="onSort"
      @row-click="toggleExpand($event.id)"
      @retry="query.refetch()"
    >
      <template #cell-expand="{ row }">
        <BaseButton
          variant="ghost"
          size="sm"
          :aria-expanded="expanded.has(row.id)"
          :aria-label="`${expanded.has(row.id) ? 'Hide' : 'Show'} requirements for ${row.driver_name}`"
          @click.stop="toggleExpand(row.id)"
        >
          <AppIcon
            :icon="expanded.has(row.id) ? ChevronDownIcon : ChevronRightIcon"
            class="size-4"
            aria-hidden="true"
          />
        </BaseButton>
      </template>
      <template #cell-driver_name="{ row }">
        <RouterLink
          :to="`/compliance/${row.id}`"
          class="font-medium text-link hover:text-link-hover"
          @click.stop
        >
          {{ row.driver_name }}
        </RouterLink>
        <span
          v-if="row.driver_status !== 'active'"
          :class="['ml-2', BADGE_BASE, toneClass('neutral')]"
        >
          {{ row.driver_status.replace("_", " ") }}
        </span>
      </template>
      <template #cell-file="{ row }">
        <span v-if="row.state === 'complete'" :class="[BADGE_BASE, toneClass('success')]"
          >complete</span
        >
        <span v-else-if="row.state === 'not_started'" :class="[BADGE_BASE, toneClass('neutral')]"
          >not started</span
        >
        <span v-else class="inline-flex flex-wrap items-center gap-1.5">
          <span
            v-for="chip in fileChips(row)"
            :key="chip.text"
            :class="[BADGE_BASE, toneClass(chip.tone)]"
            >{{ chip.text }}</span
          >
        </span>
      </template>
      <template #cell-soonest="{ row }">
        <span v-if="nextDue(row)">{{ nextDue(row) }}</span>
        <span v-else class="text-ink-tertiary">—</span>
      </template>
      <template #actions="{ row }">
        <KebabMenu>
          <RouterLink :to="`/compliance/${row.id}`" class="kebab-item"
            >Open qualification file…</RouterLink
          >
        </KebabMenu>
      </template>
      <template #expanded="{ row }">
        <div v-if="row.attention.length === 0" class="text-sm text-ink-muted">
          All requirements are on file.
          <RouterLink :to="`/compliance/${row.id}`" class="font-medium text-link hover:text-link-hover"
            >Open the file</RouterLink
          >
          to see the evidence.
        </div>
        <div v-else class="space-y-1.5">
          <div
            v-for="item in row.attention"
            :key="item.key"
            class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
          >
            <span :class="[BADGE_BASE, toneClass(STATE_TONE[item.state]), 'w-20 justify-center']">{{
              STATE_LABEL[item.state]
            }}</span>
            <span class="text-ink">{{ item.label }}</span>
            <span v-if="item.goodUntil" class="text-ink-muted">
              good until {{ formatDate(item.goodUntil) }}
              <template v-if="item.daysRemaining !== null"
                >({{ dueText(item.daysRemaining) }})</template
              >
            </span>
            <span v-else-if="item.state === 'missing'" class="text-ink-tertiary"
              >never recorded</span
            >
          </div>
          <RouterLink
            :to="`/compliance/${row.id}`"
            class="mt-1 inline-block text-sm font-medium text-link hover:text-link-hover"
          >
            Open the file to record or renew →
          </RouterLink>
        </div>
      </template>
      <template #footer>
        <TablePagination
          :page="page"
          :page-size="PAGE_SIZE"
          :total="filtered.length"
          :loading="query.isFetching.value"
          @update:page="page = $event"
        />
      </template>
    </DataTable>
  </div>
</template>
