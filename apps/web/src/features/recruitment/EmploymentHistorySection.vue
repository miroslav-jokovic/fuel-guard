<script setup lang="ts">
import { computed, ref } from "vue";
import {
  employmentCoverage,
  formatDisplayDate,
  rangesOverlap,
  CMV_WINDOW_YEARS,
  EMPLOYMENT_SOURCE_LABELS,
  EMPLOYMENT_WINDOW_YEARS,
  type EmploymentHistory,
  type EmploymentPeriod,
  type EmploymentSource,
} from "@silvicom/shared";
import {
  AppCard as BaseCard,
  AppButton as BaseButton,
  AppFormField as FormField,
  AppTextarea,
  FactList,
  QueryState,
  type Fact,
} from "@silvicom/ui";
import EmploymentTimeline from "@/components/employment/EmploymentTimeline.vue";
import EmployerFormDrawer from "@/components/employment/EmployerFormDrawer.vue";
import { EMPLOYMENT_OFFICE_COPY } from "@/components/employment/employmentCopy";
import { employerProblems, type EmployerFields } from "@/components/employment/employerRow";
import { buildTimeline, type TimelineJob } from "@/components/employment/timeline";
import RecordGapBox from "@/features/recruitment/RecordGapBox.vue";
import { useEmploymentGapsQuery } from "@/features/recruitment/useEmploymentGaps";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { formatDateRange } from "@/lib/format";
import { employmentInquiryBadge } from "@/lib/badges.recruiting";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import { useDriverQuery } from "@/composables/useDrivers";
import { historyToFields, historyWrite } from "@/features/recruitment/employmentRecord";
import {
  useAddEmployment,
  useEmploymentHistoryQuery,
  useRemoveEmployment,
  useUpdateEmployment,
} from "@/features/recruitment/useEmployment";

/**
 * One driver's §391.21(b)(10) employment history, as a section of the driver page (D1) — since HW5b
 * the one timeline and the one employer form the applicant and the review drawer use
 * (HIRING-WORKFLOW-AUDIT-2026-10-31 §4.5).
 *
 * The window ends at the HIRE DATE when we have one, not at today: §391.21(b)(10) asks about the
 * three years preceding the application, so measuring a five-year employee against today would
 * manufacture three years of gap that nobody was ever required to declare.
 *
 * What HW5b fixed here (EM-5, EM-6): Remove asks first (the panel's confirm); a job the office adds is
 * saved as "Added by the office", not "Declared on the application"; "drove a truck" starts at Yes as it
 * does for the applicant; the street, the email and both (iv) answers are asked; and the inquiry's
 * status and dates are no longer typed here — the inquiry derives them from its attempts, and a typed
 * value overwrote that on every save. The gaps are drawn but not yet explained: after filing they have
 * no home until `driver_employment_gaps` (HW5c, EM-7).
 */
const props = defineProps<{ driverId: string }>();
const driverId = computed(() => props.driverId);

const session = useSessionStore();
const toast = useToastStore();
const driverQ = useDriverQuery(driverId);
const historyQ = useEmploymentHistoryQuery(driverId);
const add = useAddEmployment();
const update = useUpdateEmployment();
const remove = useRemoveEmployment();
const copy = {
  ...EMPLOYMENT_OFFICE_COPY,
  removeMessage: "It comes off the office's record. The signed application keeps what the applicant wrote.",
};
const canEdit = computed(() => session.can("recruitment"));

const asOf = computed(
  () => driverQ.data.value?.hire_date ?? new Date().toISOString().slice(0, 10),
);

const rows = computed(() => historyQ.data.value ?? []);

const toPeriod = (r: EmploymentHistory): EmploymentPeriod => ({
  id: r.id,
  employerName: r.employer_name,
  startedOn: r.started_on,
  endedOn: r.ended_on,
  dotRegulated: r.dot_regulated,
  operatedCmv: r.operated_cmv,
  inquiryStatus: r.inquiry_status as EmploymentPeriod["inquiryStatus"],
});

const coverage = computed(() => employmentCoverage(rows.value.map(toPeriod), asOf.value));

// The two coverage summaries (D-US6). Zero gaps or inquiries reads "None" — an answer, not a blank.
const allEmploymentFacts = computed<Fact[]>(() => [
  { label: "Employers", value: coverage.value.segmentA.employers, numeric: true },
  { label: "Gaps", value: coverage.value.segmentA.gaps.length || "None", numeric: true },
  { label: "Inquiries due", value: coverage.value.inquiriesOutstanding.length || "None", numeric: true },
]);
const cmvFacts = computed<Fact[]>(() => [
  { label: "CMV employers", value: coverage.value.segmentB.cmvEmployers, numeric: true },
  { label: "Other listed", value: coverage.value.segmentB.otherEmployers, numeric: true },
]);

/** The rows as the timeline draws them; what each still lacks is the filing's own rules for a job. */
const jobs = computed<TimelineJob[]>(() =>
  rows.value.map((r) => ({
    key: r.id,
    name: r.employer_name,
    startedOn: r.started_on,
    endedOn: r.ended_on,
    operatedCmv: r.operated_cmv,
    dotRegulated: r.dot_regulated,
    missing: new Set(employerProblems(historyToFields(r), asOf.value).map((p) => p.field)).size,
    unfinished: false,
  })),
);
const rowById = (id: string): EmploymentHistory | null => rows.value.find((r) => r.id === id) ?? null;

/**
 * HW5c (0538): what explains each drawn gap — the applicant's words from the signed application and
 * the office's, recorded after signing (`RecordGapBox`). A recorded gap whose dates no longer meet a
 * drawn one (a job was added over it since) is listed below the timeline rather than dropped: it was
 * said, so the record keeps showing it.
 */
const gapsQ = useEmploymentGapsQuery(driverId);
const drawnGaps = computed(() => buildTimeline(jobs.value, asOf.value, jobs.value.length > 0).gaps);
const unplacedGaps = computed(() =>
  (gapsQ.data.value?.recorded ?? []).filter(
    (g) => !drawnGaps.value.some((d) => rangesOverlap({ from: g.startedOn, to: g.endedOn }, d)),
  ),
);

// ── the panel ────────────────────────────────────────────────────────────────────────────────
const drawerOpen = ref(false);
const editing = ref<EmploymentHistory | null>(null);
const prefill = ref<Partial<EmployerFields> | null>(null);
const errors = ref<Record<string, string>>({});
/** The office's working note on the row — the record's, not the application's, so it rides below the form. */
const notes = ref("");
const saving = computed(() => add.isPending.value || update.isPending.value || remove.isPending.value);

function openPanel(row: EmploymentHistory | null, dates: Partial<EmployerFields> | null = null): void {
  editing.value = row;
  prefill.value = dates;
  notes.value = row?.notes ?? "";
  errors.value = {};
  drawerOpen.value = true;
}

async function save(fields: EmployerFields): Promise<void> {
  const { body, errors: found } = historyWrite(fields, notes.value, driverId.value, editing.value);
  errors.value = found;
  if (!body) return;
  try {
    if (editing.value) {
      if (Object.keys(body).length > 0) {
        await update.mutateAsync({ id: editing.value.id, driverId: driverId.value, input: body as never });
      }
      toast.success("Employer updated");
    } else {
      await add.mutateAsync(body as never);
      toast.success("Employer added");
    }
    drawerOpen.value = false;
    editing.value = null;
  } catch (e) {
    toast.error("Could not save the employer", e instanceof Error ? e.message : undefined);
  }
}

/** After the panel's confirm (EM-5) — the removal used to happen straight from a kebab. */
async function removeRow(): Promise<void> {
  const row = editing.value;
  if (!row) return;
  try {
    await remove.mutateAsync({ id: row.id, driverId: driverId.value });
    toast.success("Employer removed");
    drawerOpen.value = false;
    editing.value = null;
  } catch (e) {
    toast.error("Could not remove the employer", e instanceof Error ? e.message : undefined);
  }
}

const sourceLabel = (s: string): string =>
  EMPLOYMENT_SOURCE_LABELS[s as EmploymentSource] ?? s;
</script>

<template>
  <div class="space-y-6">
    <BaseCard>
      <div class="flex items-start justify-between gap-4">
        <div>
          <h3 class="text-sm font-semibold text-ink">Employment history</h3>
          <p class="mt-1 text-sm text-ink-muted">
            Every employer in the {{ EMPLOYMENT_WINDOW_YEARS }} years before the application, plus the
            {{ CMV_WINDOW_YEARS - EMPLOYMENT_WINDOW_YEARS }} years before that where the applicant drove
            a commercial vehicle<template v-if="driverQ.data.value?.hire_date">. Measured from the hire date</template>.
          </p>
        </div>
        <BaseButton v-if="canEdit" variant="primary" @click="openPanel(null)">Add employer</BaseButton>
      </div>

      <!-- Two lists, two rules. Only the first carries a gap figure — see the note below it. -->
      <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div class="rounded-surface bg-surface-muted p-3">
          <p class="text-xs font-medium text-ink-secondary">
            All employment · {{ formatDateRange(coverage.segmentA.start, coverage.segmentA.end) }}
          </p>
          <FactList class="mt-2" :columns="3" :facts="allEmploymentFacts" />
        </div>
        <div class="rounded-surface bg-surface-muted p-3">
          <p class="text-xs font-medium text-ink-secondary">
            Commercial driving only · {{ formatDateRange(coverage.segmentB.start, coverage.segmentB.end) }}
          </p>
          <FactList class="mt-2" :columns="3" :facts="cmvFacts" />
          <!-- No gap figure here, deliberately: (b)(11) asks only for the CMV jobs, so a stretch
               without one is somebody who was not driving. -->
          <p class="mt-2 text-xs text-ink-muted">
            No gaps are reported here — time not spent driving is not a gap to explain.
          </p>
        </div>
      </div>

    </BaseCard>

    <BaseCard>
      <QueryState
        :loading="historyQ.isLoading.value"
        :error="historyQ.isError.value ? historyQ.error.value : null"
        :retrying="historyQ.isFetching.value"
        loading-text="Loading employment history…"
        error-text="Could not load employment history."
        @retry="historyQ.refetch()"
      >
        <EmploymentTimeline
          :jobs="jobs"
          :as-of="asOf"
          :copy="copy"
          :show-gaps="jobs.length > 0"
          :editable="canEdit"
          @edit="openPanel(rowById($event))"
          @add="openPanel(null, $event)"
        >
          <template #job-meta="{ job }">
            <span :class="[BADGE_BASE, toneClass(employmentInquiryBadge(rowById(job.key)?.inquiry_status ?? '').tone)]">
              {{ employmentInquiryBadge(rowById(job.key)?.inquiry_status ?? "").label }}
            </span>
            <span class="text-xs text-ink-muted">{{ sourceLabel(rowById(job.key)?.source ?? "") }}</span>
          </template>
          <template #gap="{ gap }">
            <RecordGapBox :driver-id="driverId" :gap="gap" :view="gapsQ.data.value ?? null" :can-edit="canEdit" />
          </template>
        </EmploymentTimeline>
        <div v-if="unplacedGaps.length" class="mt-4 space-y-1 border-t border-edge pt-3" data-unplaced-gaps>
          <h3 class="text-sm font-semibold text-ink">Gaps recorded for other dates</h3>
          <p v-for="g in unplacedGaps" :key="g.id" class="text-xs" :class="g.withdrawnAt ? 'text-ink-muted line-through' : 'text-ink-secondary'">
            {{ formatDisplayDate(g.startedOn) }} – {{ formatDisplayDate(g.endedOn) }}: {{ g.explanation }}
            <span class="text-ink-muted">· added by {{ g.recordedByName }}, after signing</span>
          </p>
        </div>
      </QueryState>
    </BaseCard>

    <EmployerFormDrawer
      :open="drawerOpen"
      :employer="editing ? historyToFields(editing) : null"
      :prefill="prefill"
      :copy="copy"
      id-prefix="record-employer"
      :as-of="asOf"
      :errors="errors"
      :removable="Boolean(editing)"
      :pending="saving"
      description="The office's record. The signed application is not changed."
      @save="save"
      @remove="removeRow"
      @close="drawerOpen = false"
    >
      <FormField v-slot="{ id }" label="Notes">
        <AppTextarea :id="id" v-model="notes" :rows="2" />
      </FormField>
    </EmployerFormDrawer>
  </div>
</template>
