<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { FOLLOW_UP_CATEGORIES, FOLLOW_UP_CATEGORY_LABELS, FOLLOW_UP_SEVERITIES, type FollowUpCategory, type FollowUpLine } from "@silvicom/shared";
import {
  AppBadge,
  AppTabs,
  DataTable,
  DataWorkspace,
  FilterBar,
  SORT_DIRECTIONS,
  sortRows,
  TablePagination,
  useQueryState,
  useUrlSort,
  type DataTableColumn,
} from "@silvicom/ui";
import PageHeader from "@/components/ui/PageHeader.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import { formatPhone, phoneDialString } from "@/lib/format";
import { useFollowUpsQuery } from "@/features/followUps/useFollowUps";
import FollowUpDrawer from "@/features/followUps/FollowUpDrawer.vue";
import {
  agoLabel,
  driverLabel,
  followUpListSort,
  followUpSortValue,
  matchesFollowUpSearch,
  problemDetail,
  SEVERITY_BADGE,
  stateBadge,
  unitLabel,
} from "@/features/followUps/followUpRows";

/**
 * Follow-ups — the warning desk (WARNING-DESK-PLAN §4, D-WD1/D-WD13). Samsara's warnings, one line per
 * problem that keeps happening on the same truck, trailer or driver, opened at the rule's Nth time. A
 * person calls the driver, sends the unit to the shop, and closes it with a note.
 *
 * ONE component, two screens: Maintenance › Follow-ups (`/shop/follow-ups`, every category) and Loads ›
 * Route follow-ups (`/loads/follow-ups`, `routeOnly`, category fixed to Route). Out of route is one record
 * both show, so whoever acts first closes it for both. Which categories arrive is the API's answer.
 *
 * Phone and tablet first: DataTable turns into cards under 768 px. Tab, filters, search, sort, page and the
 * open line (`open=`, the bell's deep link) are in the URL (D-US2).
 *
 * Newest activity first (D-WD18, owner 2026-11-27): the line whose last warning is the most recent leads,
 * as on every list of records (design contract §5.3). Severity no longer orders the list — it is the
 * line's badge, and the Severity filter pulls the urgent and high lines out when that is the question.
 */
const props = withDefaults(defineProps<{ routeOnly?: boolean }>(), { routeOnly: false });

const PAGE_SIZE = 20;
const qs = useQueryState();
const search = qs.param("search");
const show = qs.param("show", ["closed"]);
const whose = qs.param("whose", ["mine"]);
const severity = qs.param("severity", FOLLOW_UP_SEVERITIES);
const openId = qs.param("open");
const page = qs.page();

type Tab = FollowUpCategory | "all";
const tab = computed<Tab>({
  get: () => (props.routeOnly ? "route" : ((["all", ...FOLLOW_UP_CATEGORIES] as const).find((t) => t === qs.one("category")) ?? "all")),
  set: (v) => qs.set({ category: v === "all" ? undefined : v }),
});
const closed = computed(() => show.value === "closed");
const mine = computed(() => whose.value === "mine");
watch([search, show, whose, severity, tab], () => (page.value = 1));

const { data, isLoading, isError, isFetching, refetch } = useFollowUpsQuery(tab, closed, mine);

// "2 h ago" is read against a clock that moves with each minute's refresh.
const now = ref(Date.now());
watch(data, () => (now.value = Date.now()));

const columns: DataTableColumn[] = [
  { key: "problem", label: "Problem", sortable: true, card: "title" },
  { key: "unit", label: "Unit / driver", sortable: true, card: "sentence" },
  { key: "lastAt", label: "Last time", sortable: true, card: "meta" },
  { key: "state", label: "State", card: "status" },
];
const { sort: urlSort, onSort } = useUrlSort(
  qs.param("sort", columns.filter((c) => c.sortable).map((c) => c.key)),
  qs.param("dir", SORT_DIRECTIONS),
);
const sort = computed(() => followUpListSort(urlSort.value, closed.value));

const rows = computed(() =>
  sortRows(
    (data.value?.lines ?? []).filter((l) => (!severity.value || l.severity === severity.value) && matchesFollowUpSearch(l, search.value)),
    sort.value,
    followUpSortValue,
  ),
);
const pageRows = computed(() => rows.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));
// A pasted `?page=9` or a line closed by a colleague never leaves the desk on an empty page.
watch([() => rows.value.length, () => Boolean(data.value)], ([n, loaded]) => {
  const maxPage = Math.max(1, Math.ceil(n / PAGE_SIZE));
  if (loaded && page.value > maxPage) page.value = maxPage;
});

const tabItems = computed(() => {
  const visible: readonly FollowUpCategory[] = data.value?.categories ?? FOLLOW_UP_CATEGORIES;
  let total = 0;
  for (const c of visible) total += data.value?.counts[c] ?? 0;
  return [
    { value: "all", label: "All", badge: data.value ? total : undefined },
    ...FOLLOW_UP_CATEGORIES.filter((c) => visible.includes(c)).map((c) => ({ value: c, label: FOLLOW_UP_CATEGORY_LABELS[c], badge: data.value?.counts[c] })),
  ];
});
const showTabs = computed(() => !props.routeOnly && (data.value?.categories.length ?? 4) > 1);

const SHOW_OPTIONS = [{ value: "closed", label: "Closed" }];
const WHOSE_OPTIONS = [{ value: "mine", label: "Mine" }];
// The badge's own words, so the filter and the line cannot name a severity differently.
const SEVERITY_OPTIONS = FOLLOW_UP_SEVERITIES.map((s) => ({ value: s, label: SEVERITY_BADGE[s]?.text ?? "Normal" }));
const activeFilterCount = computed(
  () => (search.value.trim() ? 1 : 0) + (show.value ? 1 : 0) + (whose.value ? 1 : 0) + (severity.value ? 1 : 0),
);
/** Clears what narrows the list and keeps the sort (contract §5.5 rule 5). */
function resetFilters() {
  qs.set({ search: undefined, show: undefined, whose: undefined, severity: undefined });
}

const emptyText = computed(() => {
  if (closed.value) return "No follow-up was closed recently.";
  if (props.routeOnly) return "No truck is repeatedly out of route. A follow-up opens when Samsara warns about the same truck again and again.";
  return "Nothing to follow up. A line opens when Samsara warns about the same truck, trailer or driver again and again.";
});
const description = computed(() =>
  props.routeOnly
    ? "Trucks Samsara keeps warning are out of route. The shop's follow-up desk sees the same lines, so whoever handles one closes it for both."
    : "Samsara's warnings that keep happening, one line per problem. Call the driver, send the unit to the shop, and close it with a note.",
);

const lineOf = (r: unknown) => r as FollowUpLine;
function openLine(r: unknown) {
  qs.set({ open: lineOf(r).id });
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader :description="description" />

    <AppTabs v-if="showTabs" v-model="tab" :tabs="tabItems" label="Follow-up category" scrollable />

    <DataWorkspace>
      <FilterBar
        v-model:search="search"
        embedded
        search-placeholder="Search unit, driver, problem…"
        :count="rows.length"
        count-label="follow-ups"
        :active-count="activeFilterCount"
        @clear-all="resetFilters"
      >
        <template #filters>
          <FilterSelect v-model="severity" label="Severity" :options="SEVERITY_OPTIONS" />
          <FilterSelect v-model="whose" label="Whose" :options="WHOSE_OPTIONS" />
          <FilterSelect v-model="show" label="Show" :options="SHOW_OPTIONS" />
        </template>
      </FilterBar>

      <DataTable
        :columns="columns"
        :rows="pageRows"
        embedded
        row-key="id"
        :sort="sort"
        :loading="isLoading"
        :error="isError ? 'Could not load the follow-ups.' : null"
        :retrying="isFetching"
        @retry="refetch"
        @sort="onSort"
        @row-click="openLine"
      >
        <template #empty>
          <p v-if="activeFilterCount">No follow-up matches these filters.</p>
          <p v-else>{{ emptyText }}</p>
        </template>
        <template #cell-problem="{ row }">
          <span class="flex flex-wrap items-center gap-2">
            <span class="font-medium text-ink">{{ lineOf(row).ruleLabel }}</span>
            <AppBadge v-if="SEVERITY_BADGE[lineOf(row).severity]" :tone="SEVERITY_BADGE[lineOf(row).severity]!.tone">{{ SEVERITY_BADGE[lineOf(row).severity]!.text }}</AppBadge>
          </span>
          <span class="block text-xs text-ink-tertiary">{{ problemDetail(lineOf(row)) }}</span>
        </template>
        <template #cell-unit="{ row }">
          <span class="block text-ink-secondary">{{ unitLabel(lineOf(row)) }}</span>
          <span v-if="driverLabel(lineOf(row))" class="block text-ink-secondary">{{ driverLabel(lineOf(row)) }}</span>
          <a
            v-if="phoneDialString(lineOf(row).driver?.phone)"
            :href="`tel:${phoneDialString(lineOf(row).driver?.phone)}`"
            class="inline-flex min-h-12 items-center text-sm font-medium text-link hover:text-link-hover"
            @click.stop
          >
            {{ formatPhone(lineOf(row).driver?.phone) }}
          </a>
        </template>
        <template #cell-lastAt="{ value }">
          <span class="text-ink-secondary">{{ agoLabel(String(value), now) }}</span>
        </template>
        <template #cell-state="{ row }">
          <AppBadge :tone="stateBadge(lineOf(row)).tone">{{ stateBadge(lineOf(row)).text }}</AppBadge>
          <span v-if="lineOf(row).mine && !closed" class="block text-xs text-ink-tertiary">yours</span>
        </template>
        <template #footer>
          <TablePagination :page="page" :page-size="PAGE_SIZE" :total="rows.length" :loading="isFetching" @update:page="page = $event" />
        </template>
      </DataTable>
    </DataWorkspace>

    <FollowUpDrawer :id="openId || null" @close="qs.set({ open: undefined })" />
  </div>
</template>
