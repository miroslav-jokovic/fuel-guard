<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import {
  APPLICANT_REQUIREMENT_LABELS,
  APPLICANT_STAGES,
  APPLICANT_STAGE_LABELS,
  canWriteDriverLifecycle,
  type ApplicantStage,
} from "@fuelguard/shared";
import { AppCard as BaseCard, AppButton as BaseButton } from "@fuelguard/ui";
import KebabMenu from "@/components/KebabMenu.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import TablePagination from "@/components/TablePagination.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { useSessionStore } from "@/stores/session";
import { usePipelineQuery, type PipelineApplicant } from "@/features/recruitment/useEmployment";
import HireDrawer from "@/features/recruitment/HireDrawer.vue";

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
const pipelineQ = usePipelineQuery();

const PAGE_SIZE = 25;
const search = ref("");
const stage = ref("all");
const page = ref(1);

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

const STAGE_TONE: Record<ApplicantStage, string> = {
  not_started: "neutral",
  history_incomplete: "warning",
  awaiting_releases: "caution",
  ready_to_screen: "success",
};

const columns: DataTableColumn[] = [
  { key: "full_name", label: "Applicant" },
  { key: "stage", label: "Stage" },
  { key: "outstanding", label: "Waiting on" },
  { key: "employers", label: "Employers", numeric: true },
  { key: "screening", label: "Screening identity" },
];

function openApplicant(id: string): void {
  void router.push({ name: "driver-detail", params: { id }, query: { section: "employment" } });
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
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Applicants, and what each one is waiting on before they can be screened">
      <template #actions>
        <!-- The fleet-wide version of the same question. An applicant's stage says what THEY owe;
             readiness says what WE are missing before anyone can be screened at all (P0b). -->
        <BaseButton to="/recruitment/inquiries">Safety-history inquiries</BaseButton>
        <BaseButton to="/recruitment/screening">Screening readiness</BaseButton>
      </template>
    </PageHeader>

    <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <BaseCard v-for="s in APPLICANT_STAGES" :key="s" padding="sm">
        <p class="text-sm font-medium text-ink">{{ APPLICANT_STAGE_LABELS[s] }}</p>
        <p class="mt-2 text-2xl font-bold text-ink">{{ counts.get(s) ?? 0 }}</p>
      </BaseCard>
    </div>

    <FilterBar
      v-model:search="search"
      search-placeholder="Search applicants…"
      :count="rows.length"
      count-label="applicants"
    >
      <FilterSelect v-model="stage" label="Stage" :options="STAGE_FILTERS" />
    </FilterBar>

    <BaseCard padding="none">
      <DataTable
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
          <!-- Honest rather than reassuring: nobody has applied, and the surface that creates an
               applicant is H5. Saying "no results" would imply a filter hid something. -->
          <p class="text-sm text-ink-muted">
            No applicants yet. Somebody becomes an applicant when they start an application; hired
            drivers and their qualification files live under Driver Qualification.
          </p>
        </template>
        <template #cell-full_name="{ row }">
          <span class="font-medium text-ink">{{ row.full_name }}</span>
          <span class="ml-2 text-xs text-ink-muted">applied {{ row.applied_on }}</span>
        </template>
        <template #cell-stage="{ row }">
          <span :class="[BADGE_BASE, toneClass(STAGE_TONE[row.stage as ApplicantStage])]">
            {{ APPLICANT_STAGE_LABELS[row.stage as ApplicantStage] }}
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
          <KebabMenu v-if="canHire">
            <BaseButton class="kebab-item" @click="hiring = row">Hire…</BaseButton>
          </KebabMenu>
        </template>
        <template #footer>
          <TablePagination v-model:page="page" :total="rows.length" :page-size="PAGE_SIZE" />
        </template>
      </DataTable>
    </BaseCard>

    <HireDrawer
      :open="hiring !== null"
      :driver-id="hiring?.driver_id ?? null"
      :full-name="hiring?.full_name ?? ''"
      @close="hiring = null"
    />
  </div>
</template>
