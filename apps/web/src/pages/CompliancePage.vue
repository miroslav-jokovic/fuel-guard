<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { QualCertSnapshot } from "@fuelguard/shared";
import { qualifyDriver } from "@fuelguard/shared";
import { useSessionStore } from "@/stores/session";
import { useDriversQuery } from "@/composables/useDrivers";
import { useAllDriverCertsQuery, useCertificationsQuery } from "@/composables/useCompliance";
import { useTrailersQuery } from "@/features/fleet/useTrailers";
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
import { sortRows, toggleSort, type SortState } from "@/lib/sort";

/**
 * Compliance — the "who can haul hazmat" roster. Each driver's row shows whether they are
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
const { data: orgCerts } = useCertificationsQuery(ref("organization"), computed(() => session.orgId ?? null));

/** Tank endorsements matter to a fleet that owns tank equipment. Unknown-type trailers do not count:
 *  an unset type is a prompt to set it, not a reason to fail every driver. */
const fleetHasTanker = computed(() => (trailers.value ?? []).some((t) => t.trailer_type === "tanker"));
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
    arr.push({ kind: c.kind, qualifier: c.qualifier, trainingType: c.training_type, issuedAt: c.issued_at, expiresAt: c.expires_at });
    m.set(c.subject_id, arr);
  }
  return m;
});

function labelForCode(code: string): string {
  const c = code.replace(/^driver_unqualified:/, "").replace(/^training_/, "training: ").replace(/_/g, " ");
  return c.charAt(0).toUpperCase() + c.slice(1);
}

interface Row {
  id: string;
  full_name: string;
  status: string;
  ready: boolean;
  issues: string[];
  issueSummary: string;
}
const rows = computed<Row[]>(() =>
  (drivers.value ?? []).map((d) => {
    const certs = certsByDriver.value.get(d.id) ?? [];
    const res = qualifyDriver({ evalDate: today, driverStatus: d.status, certs, vehicleKind: vehicleKind.value, orgHasSecurityPlan: orgHasSecurityPlan.value });
    const issues = res.findings.map((f) => labelForCode(f.code));
    return {
      id: d.id,
      full_name: d.full_name,
      status: d.status,
      ready: res.qualified,
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
    if (statusFilter.value && r.status !== statusFilter.value) return false;
    if (issueFilter.value && !r.issues.includes(issueFilter.value)) return false;
    const term = search.value.trim().toLowerCase();
    if (term && ![r.full_name, r.status, r.issueSummary].some((value) => value.toLowerCase().includes(term))) return false;
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
    align: "left",
    headerClass: "min-w-[13rem]",
    cellClass: "font-medium text-ink",
  },
  {
    key: "status",
    label: "Employment",
    sortable: true,
    align: "left",
    headerClass: "min-w-[8rem]",
  },
  {
    key: "ready",
    label: "Qualification",
    sortable: true,
    align: "left",
    headerClass: "min-w-[10rem]",
  },
  {
    key: "issueSummary",
    label: "Missing or expired",
    align: "left",
    headerClass: "min-w-[20rem]",
    cellClass: "text-ink-secondary",
  },
];

const driverOpen = ref(false);
const activeDriver = ref<Row | null>(null);
function manage(r: Row) { activeDriver.value = r; driverOpen.value = true; }
const carrierOpen = ref(false);
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Monitor driver hazmat qualifications and resolve missing or expired credentials before dispatch.">
      <template #actions>
        <BaseButton v-if="session.canManage" @click="carrierOpen = true">Carrier records</BaseButton>
      </template>
    </PageHeader>

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
      dense
      :loading="isLoading"
      :error="isError ? errorMessage : null"
      :retrying="isFetching"
      :sort="sort"
      :empty-text="(drivers ?? []).length === 0 ? 'No drivers yet.' : 'No drivers match these filters.'"
      @sort="onSort"
      @retry="refetch"
    >
      <template #cell-full_name="{ row }">
        <button class="font-medium text-brand-600 hover:text-brand-500" @click="manage(row)">{{ row.full_name }}</button>
      </template>
      <template #cell-status="{ row }"><StatusBadge :status="row.status" /></template>
      <template #cell-ready="{ row }">
        <span
          class="inline-flex rounded-full px-2 py-0.5 text-xs font-medium"
          :class="row.ready ? 'bg-success-100 text-success-700' : 'bg-danger-100 text-danger-700'"
        >{{ row.ready ? "Ready" : "Action required" }}</span>
      </template>
      <template #cell-issueSummary="{ row }">
        <span v-if="row.ready" class="text-ink-subtle">—</span>
        <div v-else class="flex min-w-0 items-center gap-2" :title="row.issueSummary">
          <span class="max-w-[30rem] truncate text-ink-secondary">{{ row.issues[0] }}</span>
          <span
            v-if="row.issues.length > 1"
            class="shrink-0 rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium text-ink-muted"
          >+{{ row.issues.length - 1 }} more</span>
        </div>
      </template>
      <template #actions="{ row }">
        <KebabMenu v-if="session.canManage">
          <button class="kebab-item" @click="manage(row)">Manage certifications…</button>
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

    <SlideOver :open="driverOpen" :title="activeDriver ? `Certifications — ${activeDriver.full_name}` : 'Certifications'" @close="driverOpen = false">
      <CertManager v-if="activeDriver" :key="activeDriver.id" subject-type="driver" :subject-id="activeDriver.id" />
    </SlideOver>

    <SlideOver :open="carrierOpen" title="Carrier records (PHMSA registration, insurance)" @close="carrierOpen = false">
      <CertManager v-if="session.orgId" subject-type="organization" :subject-id="session.orgId || ''" />
    </SlideOver>
  </div>
</template>
