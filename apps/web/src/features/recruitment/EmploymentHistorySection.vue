<script setup lang="ts">
import { computed, ref } from "vue";
import {
  employmentCoverage,
  CMV_WINDOW_YEARS,
  EMPLOYMENT_SOURCE_LABELS,
  EMPLOYMENT_WINDOW_YEARS,
  GAP_TOLERANCE_DAYS,
  type EmploymentHistory,
  type EmploymentPeriod,
  type EmploymentSource,
} from "@silvicom/shared";
import { AppCard as BaseCard } from "@silvicom/ui";
import { AppButton as BaseButton } from "@silvicom/ui";
import SlideOver from "@/components/SlideOver.vue";
import KebabMenu from "@/components/KebabMenu.vue";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import { BADGE_BASE, employmentInquiryBadge, toneClass } from "@/lib/badges";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import { useDriverQuery } from "@/composables/useDrivers";
import EmploymentForm from "@/features/recruitment/EmploymentForm.vue";
import {
  useAddEmployment,
  useEmploymentHistoryQuery,
  useRemoveEmployment,
  useUpdateEmployment,
} from "@/features/recruitment/useEmployment";

/**
 * One driver's §391.21(b)(10) employment history, as a section of the driver page (D1).
 *
 * The window ends at the HIRE DATE when we have one, not at today: §391.21(b)(10) asks about the
 * three years preceding the application, so measuring a five-year employee against today would
 * manufacture three years of gap that nobody was ever required to declare.
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

const asOf = computed(
  () => driverQ.data.value?.hire_date ?? new Date().toISOString().slice(0, 10),
);

const toPeriod = (r: EmploymentHistory): EmploymentPeriod => ({
  id: r.id,
  employerName: r.employer_name,
  startedOn: r.started_on,
  endedOn: r.ended_on,
  dotRegulated: r.dot_regulated,
  operatedCmv: r.operated_cmv,
  inquiryStatus: r.inquiry_status as EmploymentPeriod["inquiryStatus"],
});

const coverage = computed(() =>
  employmentCoverage((historyQ.data.value ?? []).map(toPeriod), asOf.value),
);

const drawerOpen = ref(false);
const editing = ref<EmploymentHistory | null>(null);
/** Ties the footer's submit button to the form in the drawer body (contract §6.2). */
const FORM_ID = "employment-form";
const saving = computed(() => add.isPending.value || update.isPending.value);

function openAdd(): void {
  editing.value = null;
  drawerOpen.value = true;
}
function openEdit(row: EmploymentHistory): void {
  editing.value = row;
  drawerOpen.value = true;
}

async function submit(payload: Record<string, unknown>): Promise<void> {
  try {
    if (editing.value) {
      await update.mutateAsync({
        id: editing.value.id,
        driverId: driverId.value,
        input: payload as never,
      });
      toast.success("Employer updated");
    } else {
      await add.mutateAsync(payload as never);
      toast.success("Employer added");
    }
    drawerOpen.value = false;
    editing.value = null;
  } catch (e) {
    toast.error("Could not save the employer", e instanceof Error ? e.message : undefined);
  }
}

async function removeRow(row: EmploymentHistory): Promise<void> {
  try {
    await remove.mutateAsync({ id: row.id, driverId: driverId.value });
    toast.success("Employer removed");
  } catch (e) {
    toast.error("Could not remove the employer", e instanceof Error ? e.message : undefined);
  }
}

const columns: DataTableColumn[] = [
  { key: "employer_name", label: "Employer" },
  { key: "period", label: "Period" },
  { key: "usdot_number", label: "USDOT" },
  { key: "inquiry_status", label: "Safety-history inquiry" },
  { key: "source", label: "Source" },
];

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
        <BaseButton v-if="session.canManage" variant="primary" @click="openAdd">Add employer</BaseButton>
      </div>

      <!-- Two lists, two rules. Only the first carries a gap figure — see the note below it. -->
      <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div class="rounded-surface bg-surface-muted p-3">
          <p class="text-xs font-medium text-ink-secondary">
            All employment · {{ coverage.segmentA.start }} → {{ coverage.segmentA.end }}
          </p>
          <dl class="mt-2 grid grid-cols-3 gap-2 text-sm">
            <div>
              <dt class="text-ink-muted">Employers</dt>
              <dd class="font-medium text-ink">{{ coverage.segmentA.employers }}</dd>
            </div>
            <div>
              <dt class="text-ink-muted">Gaps</dt>
              <dd class="font-medium" :class="coverage.segmentA.gaps.length ? 'text-ink' : 'text-ink-muted'">
                {{ coverage.segmentA.gaps.length || "None" }}
              </dd>
            </div>
            <div>
              <dt class="text-ink-muted">Inquiries due</dt>
              <dd class="font-medium" :class="coverage.inquiriesOutstanding.length ? 'text-ink' : 'text-ink-muted'">
                {{ coverage.inquiriesOutstanding.length || "None" }}
              </dd>
            </div>
          </dl>
        </div>
        <div class="rounded-surface bg-surface-muted p-3">
          <p class="text-xs font-medium text-ink-secondary">
            Commercial driving only · {{ coverage.segmentB.start }} → {{ coverage.segmentB.end }}
          </p>
          <dl class="mt-2 grid grid-cols-3 gap-2 text-sm">
            <div>
              <dt class="text-ink-muted">CMV employers</dt>
              <dd class="font-medium text-ink">{{ coverage.segmentB.cmvEmployers }}</dd>
            </div>
            <div>
              <dt class="text-ink-muted">Other listed</dt>
              <dd class="font-medium text-ink-muted">{{ coverage.segmentB.otherEmployers }}</dd>
            </div>
          </dl>
          <!-- No gap figure here, deliberately: (b)(11) asks only for the CMV jobs, so a stretch
               without one is somebody who was not driving. -->
          <p class="mt-2 text-xs text-ink-muted">
            No gaps are reported here — time not spent driving is not a gap to explain.
          </p>
        </div>
      </div>

      <ul v-if="coverage.segmentA.gaps.length" class="mt-4 space-y-1 text-sm">
        <li v-for="g in coverage.segmentA.gaps" :key="g.from" class="text-ink-secondary">
          <span :class="[BADGE_BASE, toneClass('warning')]">{{ g.days }} days</span>
          <span class="ml-2">{{ g.from }} → {{ g.to }} is not accounted for.</span>
        </li>
      </ul>
      <p v-if="coverage.segmentA.gaps.length" class="mt-2 text-xs text-ink-muted">
        Breaks under {{ GAP_TOLERANCE_DAYS }} days are not shown. The FMCSA sets no gap threshold;
        this one is carrier practice.
      </p>
    </BaseCard>

    <BaseCard padding="none">
      <DataTable
        :columns="columns"
        :rows="historyQ.data.value ?? []"
        row-key="id"
        :loading="historyQ.isLoading.value"
        :error="historyQ.isError.value ? (historyQ.error.value?.message ?? 'Could not load employment history.') : null"
        :retrying="historyQ.isFetching.value"
        empty-text="No employers recorded yet. Add them from the driver's application."
      >
        <template #cell-employer_name="{ row }">
          <span class="font-medium text-ink">{{ row.employer_name }}</span>
          <span v-if="row.employer_city" class="ml-2 text-xs text-ink-muted">
            {{ row.employer_city }}{{ row.employer_state ? `, ${row.employer_state}` : "" }}
          </span>
          <span v-if="!row.dot_regulated" class="ml-2 text-xs text-ink-muted">· not DOT-regulated</span>
        </template>
        <template #cell-period="{ row }">
          {{ row.started_on }} → {{ row.ended_on ?? "present" }}
        </template>
        <template #cell-usdot_number="{ row }">
          <span v-if="row.usdot_number" class="font-mono text-xs text-ink-secondary">{{ row.usdot_number }}</span>
          <span v-else class="text-ink-muted">—</span>
        </template>
        <template #cell-inquiry_status="{ row }">
          <span :class="[BADGE_BASE, toneClass(employmentInquiryBadge(row.inquiry_status).tone)]">
            {{ employmentInquiryBadge(row.inquiry_status).label }}
          </span>
        </template>
        <template #cell-source="{ row }">
          <span class="text-ink-muted">{{ sourceLabel(row.source) }}</span>
        </template>
        <template #actions="{ row }">
          <KebabMenu v-if="session.canManage">
            <BaseButton class="kebab-item" @click="openEdit(row)">Edit</BaseButton>
            <BaseButton class="kebab-item" @click="removeRow(row)">Remove</BaseButton>
          </KebabMenu>
        </template>
      </DataTable>
    </BaseCard>

    <!-- size="lg" because it holds a real form, and the actions ride in #footer — contract §6.2. -->
    <SlideOver
      :open="drawerOpen"
      size="lg"
      :title="editing ? 'Edit employer' : 'Add employer'"
      @close="drawerOpen = false"
    >
      <EmploymentForm :form-id="FORM_ID" :driver-id="driverId" :existing="editing" @submit="submit" />
      <template #footer>
        <div class="flex items-center justify-end gap-3">
          <BaseButton @click="drawerOpen = false">Cancel</BaseButton>
          <BaseButton :form="FORM_ID" type="submit" variant="primary" :disabled="saving">
            {{ saving ? "Saving…" : editing ? "Save changes" : "Add employer" }}
          </BaseButton>
        </div>
      </template>
    </SlideOver>
  </div>
</template>
