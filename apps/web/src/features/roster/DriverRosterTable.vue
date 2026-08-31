<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import type { Driver, DqRosterColumnKey } from "@silvicom/shared";
import { driverAppAccess } from "@silvicom/shared";
import { AppButton as BaseButton } from "@silvicom/ui";
import { useSessionStore } from "@/stores/session";
import { useComplianceOverviewQuery } from "@/composables/useCompliance";
import { useVehiclesQuery } from "@/composables/useVehicles";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import KebabMenu from "@/components/KebabMenu.vue";
import StatusBadge from "@/components/StatusBadge.vue";
import TablePagination from "@/components/TablePagination.vue";
import { formatPhone, formatDate } from "@/lib/format";
import { BADGE_BASE, appAccessBadge, dqExpiryBadge, dqFileBadge, hosStatusBadge, toneClass } from "@/lib/badges";
import type { SortState } from "@/lib/sort";

/**
 * The roster grid (D-ROS1: it reads and navigates; the record page writes).
 *
 * Extracted from `DriversPage.vue` at R2 because that page stood at 493 lines against a 500-line
 * budget and R4 adds four more columns to this table — the page had nowhere to put them. Under
 * D-ROS10 this is also the component the vehicle and trailer rosters are meant to reuse once they
 * have a catalogue of their own, so what lives here is the TABLE: columns, cells, row menu and the
 * lookups the cells need. Filtering, sorting and paging stay with the page, which owns the toolbar
 * that drives them.
 *
 * Rows arrive already filtered, sorted and sliced. This component owns no list state on purpose —
 * two places deciding which twenty rows are on screen is the class of bug the extraction is
 * supposed to remove, not introduce.
 */
const props = defineProps<{
  /** The current page of rows — already filtered, sorted and sliced by the page. */
  rows: Driver[];
  /** The columns the reader kept, from `useTableColumns` — never the whole catalogue. */
  columns: DataTableColumn[];
  loading: boolean;
  error: string | null;
  retrying: boolean;
  sort: SortState;
  emptyText: string;
  page: number;
  pageSize: number;
  /** Total rows behind the pagination, i.e. the filtered count, not `rows.length`. */
  total: number;
}>();

const emit = defineEmits<{
  sort: [key: string];
  retry: [];
  "update:page": [page: number];
  edit: [driver: Driver];
  "manage-access": [driver: Driver];
  archive: [driver: Driver];
  restore: [driver: Driver];
}>();

const session = useSessionStore();

// HOS badge lives in lib/badges.ts (D3); the "as of" tooltip stays here with its data.
function hosAgo(iso: string | null): string {
  if (!iso) return "";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return mins < 1
    ? "as of just now"
    : mins < 60
      ? `as of ${mins} min ago`
      : `as of ${Math.round(mins / 60)}h ago`;
}

const accessBadge = (d: Driver) => appAccessBadge(driverAppAccess(d.user_id, d.app_access_enabled));

/**
 * The qualification column (D3): the roster finally answers "may this driver be dispatched" from
 * the SAME overview rollup the qualification page renders — never a second computation. A due date
 * inside 30 days outranks the plain state word, because "Due 12d" is the phone call to make today.
 * Rows the overview does not return (EFS stubs, terminated) read as "—".
 *
 * ⚠ Indexed by driver id ONCE rather than `.find()` per row. The array form was O(rows × drivers)
 * every render, and R4 adds three more columns reading this same rollup — which would have made a
 * 200-driver roster quadratic four times over.
 */
const overviewQ = useComplianceOverviewQuery();
const overviewByDriver = computed(
  () => new Map((overviewQ.data.value?.drivers ?? []).map((d) => [d.driver_id, d])),
);
const qualBadge = (driverId: string): { label: string; tone: string } | null => {
  const row = overviewByDriver.value.get(driverId);
  if (!row) return null;
  const dated = row.attention.filter((a) => a.daysRemaining !== null && a.daysRemaining >= 0);
  const soonest = dated.length ? Math.min(...dated.map((a) => a.daysRemaining as number)) : null;
  if (row.state === "incomplete" && soonest !== null && soonest <= 30 && row.counts.expired === 0) {
    return { label: `Due ${soonest}d`, tone: "warning" };
  }
  return dqFileBadge(row.state);
};

/**
 * The three §391.51 expiry cells, off the same rollup the qualification badge reads (R4, D-ROS9).
 *
 * Indexed per driver per requirement ONCE. Three columns × 20 rows searching an array per render is
 * the defect R2 removed from `qualBadge`, and adding it back three times over would have been a poor
 * way to use the lesson.
 */
const requirementsByDriver = computed(() => {
  const byDriver = new Map<string, Map<string, { state: string; goodUntil: string | null; expiryUnknown: boolean }>>();
  for (const row of overviewQ.data.value?.drivers ?? []) {
    byDriver.set(row.driver_id, new Map((row.requirements ?? []).map((r) => [r.key, r])));
  }
  return byDriver;
});
const expiry = (driverId: string, key: DqRosterColumnKey) =>
  dqExpiryBadge(requirementsByDriver.value.get(driverId)?.get(key), formatDate);

/**
 * Vehicles assigned to a driver (assignment is set from the Vehicles page). Indexed for the same
 * reason as the rollup above — a per-row `.filter()` over the whole vehicle list is the same O(n²).
 */
const { data: vehicles } = useVehiclesQuery();
const unitsByDriver = computed(() => {
  const byDriver = new Map<string, string[]>();
  for (const v of vehicles.value ?? []) {
    if (!v.assigned_driver_id) continue;
    const units = byDriver.get(v.assigned_driver_id);
    if (units) units.push(v.unit_number);
    else byDriver.set(v.assigned_driver_id, [v.unit_number]);
  }
  return byDriver;
});
const assignedUnits = (driverId: string) => unitsByDriver.value.get(driverId)?.join(", ") || "—";

</script>

<template>
  <DataTable
    embedded
    :columns="props.columns"
    :rows="props.rows"
    row-key="id"
    :loading="props.loading"
    :error="props.error"
    :retrying="props.retrying"
    :sort="props.sort"
    :empty-text="props.emptyText"
    @sort="emit('sort', $event)"
    @retry="emit('retry')"
  >
    <template #cell-samsara_username="{ row }">{{ row.samsara_username || "—" }}</template>
    <template #cell-phone="{ row }">{{ formatPhone(row.phone) }}</template>
    <template #cell-current_hos_status="{ row }">
      <span
        v-if="row.current_hos_status"
        :class="[BADGE_BASE, toneClass(hosStatusBadge(row.current_hos_status).tone)]"
        :title="hosAgo(row.current_hos_at)"
        >{{ hosStatusBadge(row.current_hos_status).label }}</span
      >
      <span v-else class="text-xs text-ink-tertiary">—</span>
    </template>
    <template #cell-current_hos_vehicle="{ row }">{{ row.current_hos_vehicle || "—" }}</template>
    <template #cell-current_location="{ row }">{{ row.current_location || "—" }}</template>
    <template #cell-app_access="{ row }">
      <div
        class="inline-flex items-center gap-1.5"
        :title="row.app_username ? `Username: ${row.app_username}` : 'No app login yet — use the row menu to create one'"
      >
        <span :class="[BADGE_BASE, toneClass(accessBadge(row).tone)]">
          {{ accessBadge(row).label }}
        </span>
        <span v-if="row.app_username" class="font-mono text-xs text-ink-muted">{{ row.app_username }}</span>
      </div>
    </template>
    <template #cell-qualification="{ row }">
      <RouterLink
        v-if="qualBadge(row.id)"
        :to="`/compliance/${row.id}`"
        :class="[BADGE_BASE, toneClass(qualBadge(row.id)!.tone)]"
      >
        {{ qualBadge(row.id)!.label }}
      </RouterLink>
      <span v-else class="text-ink-tertiary">—</span>
    </template>
    <!-- The date cells NAVIGATE, they do not edit (D-ROS1). `?section=qualification` is a public
         surface (D-ROS5) and the qualification section is where `RequirementDrawer` already lives —
         a `roster` component may not import a `compliance` one (`lint:boundaries`), and the honest
         answer to that is the sanctioned link rather than a promoted component. -->
    <template #cell-cdl_expiry="{ row }">
      <RouterLink
        v-if="expiry(row.id, 'cdl')"
        :to="`/drivers/${row.id}?section=qualification`"
        :class="expiry(row.id, 'cdl')!.urgent ? [BADGE_BASE, toneClass(expiry(row.id, 'cdl')!.tone)] : 'text-ink-secondary tabular-nums'"
      >{{ expiry(row.id, "cdl")!.label }}</RouterLink>
      <span v-else class="text-ink-tertiary">—</span>
    </template>
    <template #cell-medical_expiry="{ row }">
      <RouterLink
        v-if="expiry(row.id, 'medical_card')"
        :to="`/drivers/${row.id}?section=qualification`"
        :class="expiry(row.id, 'medical_card')!.urgent ? [BADGE_BASE, toneClass(expiry(row.id, 'medical_card')!.tone)] : 'text-ink-secondary tabular-nums'"
      >{{ expiry(row.id, "medical_card")!.label }}</RouterLink>
      <span v-else class="text-ink-tertiary">—</span>
    </template>
    <template #cell-hazmat_expiry="{ row }">
      <RouterLink
        v-if="expiry(row.id, 'endorsement_hazmat')"
        :to="`/drivers/${row.id}?section=qualification`"
        :class="expiry(row.id, 'endorsement_hazmat')!.urgent ? [BADGE_BASE, toneClass(expiry(row.id, 'endorsement_hazmat')!.tone)] : 'text-ink-secondary tabular-nums'"
      >{{ expiry(row.id, "endorsement_hazmat")!.label }}</RouterLink>
      <span v-else class="text-ink-tertiary">—</span>
    </template>
    <template #cell-vehicles="{ row }">{{ assignedUnits(row.id) }}</template>
    <template #cell-status="{ row }">
      <StatusBadge :status="row.status" />
      <span v-if="row.archived_at" :class="[BADGE_BASE, toneClass('neutral'), 'ml-2']">Archived</span>
    </template>
    <template #actions="{ row }">
      <KebabMenu v-if="session.can('roster')">
        <BaseButton class="kebab-item" @click="emit('edit', row)">Edit driver</BaseButton>
        <BaseButton class="kebab-item" @click="emit('manage-access', row)">
          {{ row.user_id ? "Manage app login…" : "Create app login…" }}
        </BaseButton>
        <RouterLink :to="`/compliance/${row.id}`" class="kebab-item"
          >Open qualification file…</RouterLink
        >
        <!-- Never "Delete". `drivers` is in RETENTION_FORBIDDEN and 0235 refuses the DELETE for
             everybody, service role included — §391.51 keeps the file for employment plus three
             years. The word on the button matches what the database will actually do. -->
        <BaseButton v-if="!row.archived_at" class="kebab-item" @click="emit('archive', row)">
          Archive…
        </BaseButton>
        <BaseButton v-else class="kebab-item" @click="emit('restore', row)">
          Restore to the roster
        </BaseButton>
      </KebabMenu>
    </template>
    <template #footer>
      <TablePagination
        :page="props.page"
        :page-size="props.pageSize"
        :total="props.total"
        @update:page="emit('update:page', $event)"
      />
    </template>
  </DataTable>
</template>
