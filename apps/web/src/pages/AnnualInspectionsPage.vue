<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { AppTabs, AppBadge, AppButton as BaseButton, AppIcon } from "@silvicom/ui";
import { PlusIcon } from "@silvicom/ui/icons";
import type { InspectionSubjectType } from "@silvicom/shared";
import PageHeader from "@/components/ui/PageHeader.vue";
import DataWorkspace from "@/components/ui/DataWorkspace.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import TablePagination from "@/components/TablePagination.vue";
import KebabMenu from "@/components/KebabMenu.vue";
import DeleteInspectionDrawer from "@/features/maintenance/DeleteInspectionDrawer.vue";
import NewInspectionDrawer from "@/features/maintenance/NewInspectionDrawer.vue";
import { useToastStore } from "@/stores/toast";
import {
  useDiscardInspection,
  useInspectionsQuery,
  type InspectionSummary,
} from "@/features/maintenance/useAnnualInspections";
import { useSessionStore } from "@/stores/session";

/**
 * The annual inspection register.
 *
 * ── TRUCKS AND TRAILERS ARE SEPARATED IN THE VIEW, NOT ONLY IN THE DATA (D-AVI12) ──────────────
 * Two tabs rather than a type column, because the two lists are read by different questions —
 * "which tractors are due" is a different sweep of the yard from "which trailers are due" — and the
 * item sets differ underneath.
 *
 * ── THE COPY NAMES THE THING, NOT THE REGULATION (D-AVI15) ─────────────────────────────────────
 * No § anywhere a reader can see it. On every non-hazmat page in this product the citations live in
 * comments beside the code that implements them, which is where this one is: the annual inspection
 * is 49 CFR §396.17, the report contents are §396.21(a), and the fourteen-month retention is
 * §396.21(b). Hazmat is the exception because there the regulation IS the subject.
 *
 * ── AN UNFINISHED INSPECTION IS A ROW WITH SOMEWHERE TO GO ─────────────────────────────────────
 * A draft is somebody halfway down a truck with fifty-six parts to answer for, and the two things
 * they need from this list are to carry on and to throw it away. Both were reachable only by opening
 * the report first, which meant the list showed the state ("In progress") and offered nothing to do
 * about it. They are row actions now (contract §5.6), destructive last.
 *
 * Discard is offered for a DRAFT only, and the API refuses a completed one by name — a filed report
 * is a record, and the way to fix one is to supersede it from inside (D-AVI4).
 *
 * ── AND ONE ROW ACTION THAT IS NOT DISCARD ─────────────────────────────────────────────────────
 * "Delete record" (D-AVI29) is the admin-only act that destroys a report and everything it filed,
 * and it sits here for the reason the list exists: cleaning up is a job you do FROM the list, and
 * having to open each report first is what made Discard unreachable in the first place.
 *
 * It is NOT a `confirm()` like Discard. Discarding a draft throws away work nobody has certified;
 * this removes a filed §396.21 record, its certification and its PDF, and hands the truck's
 * inspection date back. That needs a reason and a typed unit number, so it opens the SAME drawer the
 * report page uses — one component, so the two surfaces cannot ask for it differently.
 */

const router = useRouter();
const session = useSessionStore();

const subjectType = ref<InspectionSubjectType>("tractor");
const search = ref("");
const status = ref("");
const outcome = ref("");
const page = ref(1);
watch([subjectType, search, status, outcome], () => (page.value = 1));

const filter = computed(() => ({
  subjectType: subjectType.value,
  status: (status.value || undefined) as "draft" | "final" | undefined,
  outcome: (outcome.value || undefined) as "pass" | "fail" | undefined,
  q: search.value.trim() || undefined,
  page: page.value,
}));
const { data, isLoading, isError, error, refetch, isFetching } = useInspectionsQuery(filter);

const rows = computed(() =>
  (data.value?.inspections ?? []).map((i) => ({
    ...i,
    unit: i.unit_number ?? "—",
    verdict: i.status === "final" ? (i.outcome === "pass" ? "Passed" : "Failed") : "In progress",
  })),
);
const total = computed(() => data.value?.total ?? 0);

const tabs = [
  { value: "tractor", label: "Tractors" },
  { value: "trailer", label: "Trailers" },
];
const STATUS_OPTIONS = [
  { value: "", label: "Any" },
  { value: "draft", label: "In progress" },
  { value: "final", label: "Completed" },
];
const RESULT_OPTIONS = [
  { value: "", label: "Any" },
  { value: "pass", label: "Passed" },
  { value: "fail", label: "Failed" },
];

const columns: DataTableColumn[] = [
  { key: "unit", label: "Unit", width: "sm" },
  { key: "inspected_on", label: "Inspected", width: "md" },
  { key: "verdict", label: "Result", width: "sm" },
  { key: "next_due_on", label: "Next due", width: "md", cellClass: "text-ink-secondary" },
  { key: "inspector_name", label: "Inspector", width: "md", cellClass: "text-ink-secondary" },
  { key: "decal_serial", label: "Decal", width: "md", cellClass: "font-mono text-xs text-ink-secondary" },
];

const creating = ref(false);
function onCreated(id: string) {
  creating.value = false;
  void router.push({ name: "annual-inspection", params: { id } });
}

const toast = useToastStore();
const discard = useDiscardInspection();

/**
 * The row being deleted, held while the drawer is open.
 *
 * The row rather than its id: the drawer needs the unit number to make somebody type it back, and
 * re-deriving that from the table after the list refreshes is how it ends up blank.
 */
const deleting = ref<InspectionSummary | null>(null);

function onDeleted() {
  deleting.value = null;
  toast.success("Record deleted");
}

function openReport(row: InspectionSummary) {
  void router.push({ name: "annual-inspection", params: { id: row.id } });
}

async function discardDraft(row: InspectionSummary) {
  if (
    !confirm(
      `Discard the inspection of unit ${row.unit_number ?? "—"}? Nothing has been filed yet, and it` +
        " cannot be recovered.",
    )
  ) {
    return;
  }
  try {
    await discard.mutateAsync(row.id);
    toast.success("Inspection discarded");
  } catch (e) {
    toast.error("Could not discard the inspection", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Annual inspections for every tractor and trailer. A completed report is kept on file and produced on request.">
      <template #actions>
        <BaseButton v-if="session.can('maintenance')" variant="primary" @click="creating = true">
          <AppIcon :icon="PlusIcon" class="-ml-0.5 size-5" aria-hidden="true" /> New inspection
        </BaseButton>
      </template>
    </PageHeader>

    <AppTabs v-model="subjectType" :tabs="tabs" label="Equipment type" />

    <DataWorkspace>
    <FilterBar
      embedded
      v-model:search="search"
      search-placeholder="Search unit, decal or inspector…"
      :count="total"
      count-label="inspections"
    >
      <template #filters>
        <FilterSelect v-model="status" label="Status" :options="STATUS_OPTIONS" />
        <FilterSelect v-model="outcome" label="Result" :options="RESULT_OPTIONS" />
      </template>
    </FilterBar>

    <DataTable
      embedded
      :columns="columns"
      :rows="rows"
      :loading="isLoading || isFetching"
      :error="isError ? (error?.message ?? 'Could not load inspections') : null"
      row-key="id"
      :row-to="(row: { id: string }) => ({ name: 'annual-inspection', params: { id: row.id } })"
      @retry="() => refetch()"
    >
      <template #cell-verdict="{ row }">
        <AppBadge :tone="row.verdict === 'Passed' ? 'success' : row.verdict === 'Failed' ? 'danger' : 'neutral'">
          {{ row.verdict }}
        </AppBadge>
      </template>
      <template #cell-next_due_on="{ row }">{{ row.next_due_on ?? "—" }}</template>
      <template #cell-decal_serial="{ row }">{{ row.decal_serial ?? "—" }}</template>
      <template #actions="{ row }">
        <KebabMenu v-if="session.can('maintenance')">
          <BaseButton class="kebab-item" @click="openReport(row)">
            {{ row.status === "draft" ? "Continue inspection" : "Open report" }}
          </BaseButton>
          <BaseButton
            v-if="row.status === 'draft'"
            class="kebab-item kebab-item-danger"
            @click="discardDraft(row)"
          >
            Discard
          </BaseButton>
          <!-- Destructive last, and last of the destructive ones: this is the only action here that
               can remove a CERTIFIED report. Admin, not `can("maintenance")` — a technician
               certifies inspections, they do not destroy the record of one. -->
          <BaseButton v-if="session.admin" class="kebab-item kebab-item-danger" @click="deleting = row">
            Delete record
          </BaseButton>
        </KebabMenu>
      </template>
      <template #empty>
        No {{ subjectType === "tractor" ? "tractor" : "trailer" }} inspections yet.
      </template>
      <template #footer>
        <TablePagination :page="page" :total="total" :per-page="50" @update:page="(p: number) => (page = p)" />
      </template>
    </DataTable>
    </DataWorkspace>

    <DeleteInspectionDrawer
      v-if="deleting"
      :open="true"
      :inspection-id="deleting.id"
      :unit-number="deleting.unit_number ?? ''"
      :status="deleting.status"
      @close="deleting = null"
      @deleted="onDeleted"
    />

    <NewInspectionDrawer :open="creating" @created="onCreated" @close="creating = false" />
  </div>
</template>
