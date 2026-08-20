<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  INQUIRY_STATE_LABELS,
  INVESTIGATION_FILE_DAYS,
  type InquiryState,
} from "@fuelguard/shared";
import { AppCard as BaseCard } from "@fuelguard/ui";
import PageHeader from "@/components/ui/PageHeader.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import DataTable from "@/components/ui/DataTable.vue";
import DataWorkspace from "@/components/ui/DataWorkspace.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import TablePagination from "@/components/TablePagination.vue";
import { BADGE_BASE, inquiryStateTone, toneClass } from "@/lib/badges";
import { useInquiryQueueQuery, type InquiryQueueRow } from "@/features/recruitment/useInquiryQueue";

/**
 * The §391.23 queue (EMPLOYER-INQUIRY-PLAN E5).
 *
 * ── IT LEADS WITH OUR DEADLINE, NOT THEIRS ─────────────────────────────────────────────────────
 * §391.23(g)(1) gives the previous employer 30 days and we cannot discharge that for them.
 * §391.23(c)(1) gives US 30 days from the date employment begins to have replies **or documented
 * good-faith efforts** in the file — and that is the one an audit measures. A queue built on the
 * employer's clock says "wait, they still have eleven days"; this one says "you have eleven days to
 * have this documented, and a second attempt is documentation".
 *
 * Applicants appear with no deadline at all, ordered last. They are not late for anything —
 * §391.23(c)(1) has no date to count from until somebody is hired — but sending early is precisely
 * how a carrier makes that deadline, so hiding them would hide the cheapest work on the list.
 */
const queueQ = useInquiryQueueQuery();

const filter = ref("all");
const search = ref("");
const PAGE_SIZE = 20;
const page = ref(1);
watch([filter, search], () => (page.value = 1));

const filtered = computed<InquiryQueueRow[]>(() => {
  let all = queueQ.data.value?.rows ?? [];
  if (filter.value === "overdue") all = all.filter((r) => r.daysToDeadline !== null && r.daysToDeadline < 0);
  if (filter.value === "chase") {
    all = all.filter((r) => r.outstanding.some((e) => e.state === "overdue" || e.state === "undeliverable"));
  }
  if (filter.value === "applicants") all = all.filter((r) => r.status === "applicant");
  const q = search.value.trim().toLowerCase();
  if (!q) return all;
  return all.filter(
    (r) =>
      r.name.toLowerCase().includes(q) ||
      r.outstanding.some((e) => e.employerName.toLowerCase().includes(q)),
  );
});

const pageRows = computed(() => filtered.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));

const summary = computed(() => queueQ.data.value?.summary ?? null);

/** The deadline as a person reads it, rather than a signed integer. */
function deadlineLabel(row: InquiryQueueRow): string {
  if (row.daysToDeadline === null) return "Not hired yet";
  if (row.daysToDeadline < 0) return `${Math.abs(row.daysToDeadline)} days over`;
  if (row.daysToDeadline === 0) return "Due today";
  return `${row.daysToDeadline} days left`;
}

const deadlineTone = (row: InquiryQueueRow): string => {
  if (row.daysToDeadline === null) return "neutral";
  if (row.daysToDeadline < 0) return "danger";
  return row.daysToDeadline <= 7 ? "warning" : "info";
};

const columns: DataTableColumn[] = [
  { key: "name", label: "Driver" },
  { key: "deadline", label: "§391.23(c)(1) deadline" },
  { key: "employers", label: "Outstanding" },
];
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Every safety-history investigation with work left, closest to its deadline first" />

    <BaseCard v-if="summary">
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <p class="text-sm text-ink-muted">Files with work left</p>
          <p class="mt-1 text-2xl font-bold text-ink">{{ summary.outstanding }}</p>
        </div>
        <div>
          <p class="text-sm text-ink-muted">Past their {{ INVESTIGATION_FILE_DAYS }}-day deadline</p>
          <p class="mt-1 text-2xl font-bold" :class="summary.overdue ? 'text-ink' : 'text-ink-muted'">
            {{ summary.overdue }}
          </p>
        </div>
        <div>
          <p class="text-sm text-ink-muted">Employers to chase or document</p>
          <p class="mt-1 text-2xl font-bold" :class="summary.chaseable ? 'text-ink' : 'text-ink-muted'">
            {{ summary.chaseable }}
          </p>
        </div>
      </div>
      <p class="mt-4 text-sm text-ink-muted">
        §391.23(c)(1) gives you {{ INVESTIGATION_FILE_DAYS }} days from the date a driver starts to
        have the replies — <span class="font-medium text-ink-secondary">or a documented record of
        trying</span> — in their file. An employer who never answers does not hold the file open; an
        undocumented attempt does.
      </p>
    </BaseCard>

    <DataWorkspace>
      <FilterBar
        v-model:search="search"
        embedded
        search-placeholder="Search driver, former employer…"
        :count="filtered.length"
        count-label="files"
      >
        <template #filters>
          <FilterSelect
            v-model="filter"
            label="Show"
            :options="[
              { value: 'all', label: 'Everything outstanding' },
              { value: 'overdue', label: 'Past the deadline' },
              { value: 'chase', label: 'Ready to chase or document' },
              { value: 'applicants', label: 'Applicants' },
            ]"
          />
        </template>
      </FilterBar>
      <DataTable
        :columns="columns"
        :rows="pageRows"
        embedded
        row-key="driverId"
        :loading="queueQ.isLoading.value"
        :error="queueQ.isError.value ? (queueQ.error.value?.message ?? 'Could not load the queue.') : null"
        :retrying="queueQ.isFetching.value"
        empty-text="Nothing outstanding. Every DOT-regulated employer has answered or been documented."
      >
        <template #cell-name="{ row }">
          <RouterLink
            :to="`/drivers/${row.driverId}?section=employment`"
            class="font-medium text-ink hover:underline"
          >
            {{ row.name }}
          </RouterLink>
          <span v-if="row.status === 'applicant'" class="ml-2 text-xs text-ink-muted">applicant</span>
        </template>
        <template #cell-deadline="{ row }">
          <span :class="[BADGE_BASE, toneClass(deadlineTone(row))]">{{ deadlineLabel(row) }}</span>
          <span v-if="row.fileDeadline" class="ml-2 text-xs text-ink-muted">{{ row.fileDeadline }}</span>
        </template>
        <template #cell-employers="{ row }">
          <ul class="space-y-1">
            <li v-for="employer in row.outstanding" :key="employer.employmentId" class="text-sm">
              <span :class="[BADGE_BASE, inquiryStateTone(employer.state)]">
                {{ INQUIRY_STATE_LABELS[employer.state as InquiryState] }}
              </span>
              <span class="ml-2 text-ink-secondary">{{ employer.employerName }}</span>
              <span v-if="employer.attempts > 1" class="ml-1 text-xs text-ink-muted">
                · {{ employer.attempts }} attempts
              </span>
            </li>
          </ul>
        </template>
        <template #footer>
          <TablePagination
            :page="page"
            :page-size="PAGE_SIZE"
            :total="filtered.length"
            :loading="queueQ.isFetching.value"
            @update:page="page = $event"
          />
        </template>
      </DataTable>
    </DataWorkspace>
  </div>
</template>
