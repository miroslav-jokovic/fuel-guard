<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import {
  APPLICANT_REQUIREMENT_LABELS,
  APPLICANT_STAGES,
  APPLICANT_STAGE_LABELS,
  canWriteDriverLifecycle,
  rolesThatManage,
  type ApplicantStage,
} from "@silvicom/shared";
import { AppButton as BaseButton } from "@silvicom/ui";
import KebabMenu from "@/components/KebabMenu.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import DataTable from "@/components/ui/DataTable.vue";
import DataWorkspace from "@/components/ui/DataWorkspace.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import TablePagination from "@/components/TablePagination.vue";
import StatCard from "@/components/ui/StatCard.vue";
import {
  applicantDispositionBadge,
  applicantStageBadge,
  BADGE_BASE,
  toneClass,
} from "@/lib/badges";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import { useArchiveDriver } from "@/composables/useDrivers";
import { usePipelineQuery, type PipelineApplicant } from "@/features/recruitment/useEmployment";
import HireDrawer from "@/features/recruitment/HireDrawer.vue";
import InviteApplicantDrawer from "@/features/recruitment/InviteApplicantDrawer.vue";
import ArchiveDriverModal from "@/components/ArchiveDriverModal.vue";

/**
 * Recruitment — the applicant pipeline (HIRING-PLAN.md H6).
 *
 * This replaced a fleet table of every driver with their gaps and safety-history inquiry state,
 * which restated what the driver qualification page already owns. The boundary that fixes it is
 * D-HIRE2: **Recruitment owns the applicant, DQF owns the driver.** Once this lists applicants the
 * two surfaces are not looking at the same people, and the duplication has nowhere to come from.
 *
 * Employment history for somebody already hired has not gone anywhere — it is on their driver page,
 * where a §391.51 file is, rather than in a second fleet-wide table here.
 *
 * Every stage is DERIVED, server-side, by the same pure function this page could call. There is no
 * stage column to advance and therefore none to forget.
 */
const router = useRouter();
/**
 * The board, and its other half. Archived applicants leave this list and nothing else (0235) — their
 * row, their draft and anything they signed are untouched, and their own page still opens. The chip
 * is a VIEW rather than a second page, so the columns, the stage computation and the ordering cannot
 * drift between the two.
 */
const showArchived = ref(false);
const pipelineQ = usePipelineQuery(showArchived);

const PAGE_SIZE = 25;
const search = ref("");
const stage = ref("all");
const page = ref(1);

const VIEW_FILTERS = [
  { value: "live", label: "Applicants" },
  { value: "archived", label: "Archived" },
];

const STAGE_FILTERS = [
  { value: "all", label: "All applicants" },
  ...APPLICANT_STAGES.map((s) => ({ value: s, label: APPLICANT_STAGE_LABELS[s] })),
];

const rows = computed(() => {
  const q = search.value.trim().toLowerCase();
  return (pipelineQ.data.value ?? [])
    .filter((a) => (q ? a.full_name.toLowerCase().includes(q) : true))
    .filter((a) => stage.value === "all" || a.stage === stage.value);
});
const paged = computed(() => rows.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));

/** Counts per stage, so the filter bar says how much work sits behind each word. */
const counts = computed(() => {
  const out = new Map<ApplicantStage, number>();
  for (const a of pipelineQ.data.value ?? []) out.set(a.stage, (out.get(a.stage) ?? 0) + 1);
  return out;
});

const columns: DataTableColumn[] = [
  { key: "full_name", label: "Applicant" },
  { key: "stage", label: "Stage" },
  { key: "outstanding", label: "Waiting on" },
  { key: "employers", label: "Employers", numeric: true },
  { key: "screening", label: "Screening identity" },
];

/**
 * ⚠ `application`, not `employment`, since U6 (D-UI7). Clicking a row on the applicant board means
 * "open their application" — it always did, and it said `employment` only because that one tab held
 * the invite card as well as the history. The tab it wanted now has its own name.
 */
function openApplicant(id: string): void {
  // R7: the applicant record is the recruitment surface's own page now, not a tab on the driver
  // page. The old destination still resolves and redirects here, so nobody's bookmark broke.
  void router.push({ name: "applicant-record", params: { id } });
}

/**
 * Hiring is not a recruitment act, and the affordance says so. `drivers.status` starts the
 * §391.51(c) retention clock and decides driver-app access, so 0213 refuses a recruiter's status
 * change in a trigger — offering them a Hire button would be offering an action the database
 * blocks. They see everything else on this board.
 */
const session = useSessionStore();
const canHire = computed(() => canWriteDriverLifecycle(session.role));
const hiring = ref<PipelineApplicant | null>(null);

/**
 * U1/D-UI1 — the act that STARTS an application, on the page named after applicants.
 *
 * It lived only inside a driver's Employment tab, which meant somebody had to be created as a
 * driver under Fleet before they could be invited to become one. Hiring is gated harder (0213
 * refuses a recruiter's status change in a trigger, so `canHire` is `canWriteDriverLifecycle`);
 * inviting is recruitment's own work and takes the section gate.
 */
const canInvite = computed(() => {
  const role = session.role;
  return Boolean(role) && rolesThatManage("recruitment").includes(role!);
});
const inviting = ref(false);

const archiving = ref<PipelineApplicant | null>(null);
const archiveDriver = useArchiveDriver();
const toast = useToastStore();

/**
 * `view` is the chip; `showArchived` is what the query reads. Two refs rather than one because
 * `FilterSelect` speaks strings and the query wants a boolean, and switching views resets the page —
 * landing on page 3 of a list that has four rows is the bug this line exists to prevent.
 */
const view = computed({
  get: () => (showArchived.value ? "archived" : "live"),
  set: (v: string) => {
    showArchived.value = v === "archived";
    page.value = 1;
  },
});

async function setArchived(applicant: PipelineApplicant, archived: boolean) {
  try {
    await archiveDriver.mutateAsync({ id: applicant.driver_id, archived });
    toast.success(
      archived ? "Archived" : "Restored",
      archived
        ? `${applicant.full_name} is off the board. Nothing they filled in or signed was changed.`
        : `${applicant.full_name} is back on the board.`,
    );
  } catch (e) {
    toast.error(
      archived ? "Could not archive" : "Could not restore",
      e instanceof Error ? e.message : undefined,
    );
  } finally {
    archiving.value = null;
  }
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Applicants, and what each one is waiting on before they can be screened">
      <template #actions>
        <!-- The fleet-wide version of the same question. An applicant's stage says what THEY owe;
             readiness says what WE are missing before anyone can be screened at all (P0b). Both are
             nav items since U1 as well — a button answers "from here", a nav entry answers "at all". -->
        <BaseButton to="/recruitment/inquiries">Safety-history inquiries</BaseButton>
        <BaseButton to="/recruitment/screening">Screening readiness</BaseButton>
        <BaseButton v-if="canInvite" variant="primary" @click="inviting = true">
          Invite an applicant
        </BaseButton>
      </template>
    </PageHeader>

    <!-- U3/D-UI2: the shared tile. These were four hand-rolled cards whose label was a body role
         (`text-sm font-medium text-ink`) rather than contract §2.4's KPI label. -->
    <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <StatCard
        v-for="s in APPLICANT_STAGES"
        :key="s"
        :label="APPLICANT_STAGE_LABELS[s]"
        :value="counts.get(s) ?? 0"
        :loading="pipelineQ.isLoading.value"
      />
    </div>

    <!-- U5/D-UI3: `DataWorkspace` → `FilterBar embedded` → `DataTable embedded`, contract §5.2b.
         R0b rebuilt this page's two siblings on that shell and correctly left this one alone under
         its "existing standalone-cards pages stay as they are" clause — which is how ONE area ended
         up with two shells, a loose toolbar floating above a separate card beside two seamless
         workspaces. The clause is not reopened for anywhere else; this crosses it for this area only. -->
    <DataWorkspace>
      <FilterBar
        v-model:search="search"
        embedded
        search-placeholder="Search applicants…"
        :count="rows.length"
        count-label="applicants"
      >
        <template #filters>
          <FilterSelect v-model="stage" label="Stage" :options="STAGE_FILTERS" />
          <FilterSelect v-model="view" label="Show" :options="VIEW_FILTERS" />
        </template>
      </FilterBar>
      <DataTable
        embedded
        :columns="columns"
        :rows="paged"
        row-key="driver_id"
        :loading="pipelineQ.isLoading.value"
        :error="pipelineQ.isError.value ? (pipelineQ.error.value?.message ?? 'Could not load the pipeline.') : null"
        :retrying="pipelineQ.isFetching.value"
        :row-class="() => 'cursor-pointer'"
        @row-click="(row: PipelineApplicant) => openApplicant(row.driver_id)"
      >
        <template #empty>
          <!-- Honest rather than reassuring: nobody has applied, so "no results" would imply a
               filter hid somebody. Fact, then the next action (§4's empty-state rule) — before U1
               this said an applicant appears "when they start an application" and offered no way to
               start one, which was true and circular. -->
          <p class="text-sm text-ink-muted">
            No applicants yet. Invite one and they fill in their own driver application; hired drivers
            and their qualification files live under Driver Qualification.
          </p>
          <div v-if="canInvite" class="mt-4">
            <BaseButton variant="primary" @click="inviting = true">Invite an applicant</BaseButton>
          </div>
        </template>
        <template #cell-full_name="{ row }">
          <span class="font-medium text-ink">{{ row.full_name }}</span>
          <span class="ml-2 text-xs text-ink-muted">applied {{ row.applied_on }}</span>
          <span v-if="showArchived" :class="[BADGE_BASE, toneClass('neutral'), 'ml-2']">Archived</span>
        </template>
        <!--
          ⚠ A decided application shows the DECISION, not its progress. "Awaiting releases" beside a
          decline is not extra information, it is a stale sentence about somebody the carrier already
          answered — and it is what would send the next recruiter to chase them. The decision
          supersedes the stage; the row itself stays, because leaving the board is what archiving is
          for (0235) and the two acts are deliberately separate.
        -->
        <template #cell-stage="{ row }">
          <span
            v-if="row.disposition"
            :class="[BADGE_BASE, toneClass(applicantDispositionBadge(row.disposition.outcome).tone)]"
          >
            {{ applicantDispositionBadge(row.disposition.outcome).label }}
          </span>
          <span v-else :class="[BADGE_BASE, toneClass(applicantStageBadge(row.stage as ApplicantStage).tone)]">
            {{ applicantStageBadge(row.stage as ApplicantStage).label }}
          </span>
        </template>
        <template #cell-outstanding="{ row }">
          <span v-if="row.outstanding.length === 0" class="text-ink-muted">Nothing</span>
          <span v-else class="text-ink-secondary">
            {{ row.outstanding.map((r: keyof typeof APPLICANT_REQUIREMENT_LABELS) => APPLICANT_REQUIREMENT_LABELS[r]).join(", ") }}
          </span>
        </template>
        <template #cell-employers="{ row }">
          {{ row.employers_in_window }}<span class="text-ink-muted"> · {{ row.cmv_employers }} CMV</span>
        </template>
        <template #cell-screening="{ row }">
          <span v-if="row.date_of_birth_recorded" :class="[BADGE_BASE, toneClass('success')]">Ready</span>
          <span v-else :class="[BADGE_BASE, toneClass('caution')]">No date of birth</span>
        </template>
        <template #actions="{ row }">
          <KebabMenu v-if="canHire || canInvite">
            <BaseButton v-if="canHire && !showArchived" class="kebab-item" @click="hiring = row">Hire…</BaseButton>
            <BaseButton v-if="canInvite && !showArchived" class="kebab-item" @click="archiving = row">
              Archive…
            </BaseButton>
            <BaseButton v-if="canInvite && showArchived" class="kebab-item" @click="setArchived(row, false)">
              Restore
            </BaseButton>
          </KebabMenu>
        </template>
        <template #footer>
          <TablePagination v-model:page="page" :total="rows.length" :page-size="PAGE_SIZE" />
        </template>
      </DataTable>
    </DataWorkspace>

    <ArchiveDriverModal
      :subject="archiving"
      kind="applicant"
      :busy="archiveDriver.isPending.value"
      @close="archiving = null"
      @confirm="archiving && setArchived(archiving, true)"
    />

    <InviteApplicantDrawer
      :open="inviting"
      @close="inviting = false"
      @created="pipelineQ.refetch()"
    />

    <HireDrawer
      :open="hiring !== null"
      :driver-id="hiring?.driver_id ?? null"
      :full-name="hiring?.full_name ?? ''"
      @close="hiring = null"
    />
  </div>
</template>
