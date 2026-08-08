<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import type { QualCertSnapshot, QualState } from "@fuelguard/shared";
import { qualifyDriver } from "@fuelguard/shared";
import { useSessionStore } from "@/stores/session";
import { useDriversQuery } from "@/composables/useDrivers";
import { useAllDriverCertsQuery, useCertificationsQuery } from "@/composables/useCompliance";
import { useTrailersQuery } from "@/composables/useTrailers";
import PageHeader from "@/components/ui/PageHeader.vue";
import BaseButton from "@/components/ui/BaseButton.vue";
import FilterBar, { type FilterChip } from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import TablePagination from "@/components/TablePagination.vue";
import StatusBadge from "@/components/StatusBadge.vue";
import SlideOver from "@/components/SlideOver.vue";
import KebabMenu from "@/components/KebabMenu.vue";
import CertManager from "@/features/hazmat/CertManager.vue";
import QualificationQueue from "@/features/compliance/QualificationQueue.vue";
import { sortRows, toggleSort, type SortState } from "@/lib/sort";
import { BADGE_BASE, toneClass } from "@/lib/badges";

/**
 * Driver Qualification (DQ redesign, D-DQ6).
 *
 * Two tabs, and the DEFAULT is the queue, not the roster. A safety manager's morning question is
 * "what expires in the next thirty days across my fleet"; an alphabetical roster answers a question
 * nobody asked. The roster stays as the second tab, because "show me everyone" is a real need — just
 * not the daily one.
 *
 * Clicking a driver opens their file at /compliance/:id (D-DQ7) rather than a drawer: eighteen
 * requirements, their documents and their history is a workspace, not a peek.
 *
 * The old roster — Each driver's row shows whether they are
 * hazmat-qualified (computed with the SAME qualifyDriver gate the analysis uses) and what is
 * missing/expired; clicking a driver opens a drawer to manage their certifications. The carrier's
 * own records (PHMSA registration, insurance) live behind the header button. Populating these is
 * what turns a hazmat load from "needs review" into a clear.
 */
const session = useSessionStore();
const {
  data: drivers,
  isLoading: driversLoading,
  isError: driversFailed,
  error: driversError,
  refetch: refetchDrivers,
  isFetching: driversFetching,
} = useDriversQuery();
const {
  data: driverCerts,
  isLoading: certsLoading,
  isError: certsFailed,
  error: certsError,
  refetch: refetchCerts,
  isFetching: certsFetching,
} = useAllDriverCertsQuery();

// F-H2 / F-P2. This page graded EVERY driver in EVERY organization against cargo-tank criteria —
// `vehicleKind: "cargo_tank"` and `orgHasSecurityPlan: false` were both literals — so a fleet that has
// never hauled a tank in its life saw every driver as "Action required" for want of an N/X endorsement.
// Both now come from what the organization actually has.
const { data: trailers } = useTrailersQuery();
const { data: orgCerts } = useCertificationsQuery(
  ref("organization"),
  computed(() => session.orgId ?? null),
);

/** Tank endorsements matter to a fleet that owns tank equipment. Unknown-type trailers do not count:
 *  an unset type is a prompt to set it, not a reason to fail every driver. */
const fleetHasTanker = computed(() =>
  (trailers.value ?? []).some((t) => t.trailer_type === "tanker"),
);
const vehicleKind = computed<"cargo_tank" | "van_or_flatbed">(() =>
  fleetHasTanker.value ? "cargo_tank" : "van_or_flatbed",
);
const orgHasSecurityPlan = computed(() =>
  (orgCerts.value ?? []).some((c) => c.kind === "security_plan" && !c.superseded_by),
);

const isLoading = computed(() => driversLoading.value || certsLoading.value);
const isError = computed(() => driversFailed.value || certsFailed.value);
const errorMessage = computed(() => {
  const queryError = driversError.value ?? certsError.value;
  return queryError instanceof Error ? queryError.message : "Failed to load compliance records";
});
const isFetching = computed(() => driversFetching.value || certsFetching.value);
function refetch() {
  void Promise.all([refetchDrivers(), refetchCerts()]);
}

const today = new Date().toISOString().slice(0, 10);

const certsByDriver = computed(() => {
  const m = new Map<string, QualCertSnapshot[]>();
  for (const c of driverCerts.value ?? []) {
    const arr = m.get(c.subject_id) ?? [];
    arr.push({
      kind: c.kind,
      qualifier: c.qualifier,
      trainingType: c.training_type,
      issuedAt: c.issued_at,
      expiresAt: c.expires_at,
    });
    m.set(c.subject_id, arr);
  }
  return m;
});

function labelForCode(code: string): string {
  const c = code
    .replace(/^driver_unqualified:/, "")
    .replace(/^training_/, "training: ")
    .replace(/_/g, " ");
  return c.charAt(0).toUpperCase() + c.slice(1);
}

/**
 * How a qualification state is shown (F-H1). "Not started" is deliberately NEUTRAL, not red: on a
 * fleet's first day every driver is in that state, and a roster of red rows that all mean "nobody has
 * filed anything yet" is how a real disqualification later gets scrolled past. The gate itself is
 * unchanged — none of these three is `ready` except the first.
 */
const QUAL_TONE: Record<QualState, string> = {
  qualified: "success",
  incomplete: "danger",
  not_started: "neutral",
};
/** Lowercase because BADGE_BASE capitalises — the same reason every other badge source is lowercase. */
const QUAL_LABEL: Record<QualState, string> = {
  qualified: "ready",
  incomplete: "action required",
  not_started: "not started",
};

interface Row {
  id: string;
  full_name: string;
  status: string;
  ready: boolean;
  state: QualState;
  issues: string[];
  issueSummary: string;
}
const rows = computed<Row[]>(() =>
  (drivers.value ?? []).map((d) => {
    const certs = certsByDriver.value.get(d.id) ?? [];
    const res = qualifyDriver({
      evalDate: today,
      driverStatus: d.status,
      certs,
      vehicleKind: vehicleKind.value,
      orgHasSecurityPlan: orgHasSecurityPlan.value,
    });
    const issues = res.findings.map((f) => labelForCode(f.code));
    return {
      id: d.id,
      full_name: d.full_name,
      status: d.status,
      ready: res.qualified,
      state: res.state,
      issues,
      issueSummary: issues.join(", "),
    };
  }),
);

const search = ref("");
const readyFilter = ref<string>("");
const statusFilter = ref("");
const issueFilter = ref("");
const readyOptions = [
  { value: "", label: "All qualifications" },
  { value: "ready", label: "Ready" },
  { value: "not_ready", label: "Action required" },
  // Its own filter because it is its own job: onboarding a fleet is not the same task as chasing an
  // expired medical card, and during a rollout this is the only list that matters.
  { value: "not_started", label: "Not started" },
];
const statusOptions = computed(() => [
  { value: "", label: "All employment statuses" },
  ...[...new Set(rows.value.map((row) => row.status))]
    .sort((a, b) => a.localeCompare(b))
    .map((status) => ({ value: status, label: labelForCode(status) })),
]);
const issueOptions = computed(() => [
  { value: "", label: "All issues" },
  ...[...new Set(rows.value.flatMap((row) => row.issues))]
    .sort((a, b) => a.localeCompare(b))
    .map((issue) => ({ value: issue, label: issue })),
]);

const filtered = computed(() =>
  rows.value.filter((r) => {
    if (readyFilter.value === "ready" && !r.ready) return false;
    if (readyFilter.value === "not_ready" && r.ready) return false;
    if (readyFilter.value === "not_started" && r.state !== "not_started") return false;
    if (statusFilter.value && r.status !== statusFilter.value) return false;
    if (issueFilter.value && !r.issues.includes(issueFilter.value)) return false;
    const term = search.value.trim().toLowerCase();
    if (
      term &&
      ![r.full_name, r.status, r.issueSummary].some((value) => value.toLowerCase().includes(term))
    )
      return false;
    return true;
  }),
);

const chips = computed<FilterChip[]>(() =>
  statusFilter.value
    ? [{ key: "status", label: "Employment", value: labelForCode(statusFilter.value) }]
    : [],
);
const moreCount = computed(() => (statusFilter.value ? 1 : 0));
function removeChip(key: string) {
  if (key === "status") statusFilter.value = "";
}
function clearAll() {
  search.value = "";
  readyFilter.value = "";
  statusFilter.value = "";
  issueFilter.value = "";
}

const sort = ref<SortState>({ key: "ready", dir: "asc" });
function onSort(key: string) {
  sort.value = toggleSort(sort.value, key);
}
const sorted = computed(() => sortRows(filtered.value, sort.value));

const PAGE_SIZE = 20;
const page = ref(1);
watch([search, readyFilter, statusFilter, issueFilter], () => (page.value = 1));
const pageRows = computed(() =>
  sorted.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE),
);

const columns: DataTableColumn[] = [
  {
    key: "full_name",
    label: "Driver",
    sortable: true,
    headerClass: "min-w-[13rem]",
    cellClass: "font-medium text-ink",
  },
  {
    key: "status",
    label: "Employment",
    sortable: true,
    headerClass: "min-w-[8rem]",
  },
  {
    key: "ready",
    label: "Qualification",
    sortable: true,
    headerClass: "min-w-[10rem]",
  },
  {
    key: "issueSummary",
    label: "Missing or expired",
    headerClass: "min-w-[20rem]",
    cellClass: "text-ink-secondary",
  },
];

const tab = ref<"queue" | "roster">("queue");
const TABS = [
  { value: "queue", label: "Needs attention" },
  { value: "roster", label: "All drivers" },
] as const;
const carrierOpen = ref(false);
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      description="Monitor driver hazmat qualifications and resolve missing or expired credentials before dispatch."
    >
      <template #actions>
        <BaseButton v-if="session.canManage" @click="carrierOpen = true"
          >Carrier records</BaseButton
        >
      </template>
    </PageHeader>

    <nav
      class="flex gap-1 rounded-lg bg-surface-muted p-1 text-sm"
      role="tablist"
      aria-label="Qualification view"
    >
      <button
        v-for="t in TABS"
        :key="t.value"
        type="button"
        role="tab"
        class="rounded-md px-3 py-1.5 font-medium transition"
        :class="
          tab === t.value
            ? 'bg-surface text-ink shadow-sm'
            : 'text-ink-muted hover:text-ink-secondary'
        "
        :aria-selected="tab === t.value"
        @click="tab = t.value"
      >
        {{ t.label }}
      </button>
    </nav>

    <QualificationQueue v-if="tab === 'queue'" />

    <template v-else>
      <FilterBar
        v-model:search="search"
        search-placeholder="Search driver or compliance issue…"
        :count="filtered.length"
        count-label="drivers"
        :chips="chips"
        :more-count="moreCount"
        @remove="removeChip"
        @clear-all="clearAll"
      >
        <template #filters>
          <FilterSelect v-model="readyFilter" label="Qualification" :options="readyOptions" />
          <FilterSelect v-model="issueFilter" label="Issue" :options="issueOptions" />
        </template>
        <template #more>
          <FilterSelect v-model="statusFilter" label="Employment" :options="statusOptions" block />
        </template>
      </FilterBar>

      <DataTable
        :columns="columns"
        :rows="pageRows"
        row-key="id"
        :loading="isLoading"
        :error="isError ? errorMessage : null"
        :retrying="isFetching"
        :sort="sort"
        :empty-text="
          (drivers ?? []).length === 0 ? 'No drivers yet.' : 'No drivers match these filters.'
        "
        @sort="onSort"
        @retry="refetch"
      >
        <template #cell-full_name="{ row }">
          <RouterLink
            :to="`/compliance/${row.id}`"
            class="font-medium text-brand-600 hover:text-brand-500"
          >
            {{ row.full_name }}
          </RouterLink>
        </template>
        <template #cell-status="{ row }"><StatusBadge :status="row.status" /></template>
        <template #cell-ready="{ row }">
          <span :class="[BADGE_BASE, toneClass(QUAL_TONE[row.state])]">{{
            QUAL_LABEL[row.state]
          }}</span>
        </template>
        <template #cell-issueSummary="{ row }">
          <span v-if="row.ready" class="text-ink-subtle">—</span>
          <div v-else class="flex min-w-0 items-center gap-2" :title="row.issueSummary">
            <span class="truncate text-ink-secondary">{{ row.issues[0] }}</span>
            <span
              v-if="row.issues.length > 1"
              :class="['shrink-0', BADGE_BASE, toneClass('neutral')]"
            >
              +{{ row.issues.length - 1 }} more
            </span>
          </div>
        </template>
        <template #actions="{ row }">
          <KebabMenu v-if="session.canManage">
            <RouterLink :to="`/compliance/${row.id}`" class="kebab-item"
              >Open qualification file…</RouterLink
            >
          </KebabMenu>
        </template>
        <template #footer>
          <TablePagination
            :page="page"
            :page-size="PAGE_SIZE"
            :total="filtered.length"
            :loading="isFetching"
            @update:page="page = $event"
          />
        </template>
      </DataTable>
    </template>

    <SlideOver
      :open="carrierOpen"
      size="lg"
      title="Carrier records (PHMSA registration, insurance)"
      @close="carrierOpen = false"
    >
      <CertManager
        v-if="session.orgId"
        subject-type="organization"
        :subject-id="session.orgId || ''"
      />
    </SlideOver>
  </div>
</template>
