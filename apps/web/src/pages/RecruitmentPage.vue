<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { AppCard as BaseCard } from "@fuelguard/ui";
import PageHeader from "@/components/ui/PageHeader.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import TablePagination from "@/components/TablePagination.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { useRecruitmentRosterQuery } from "@/features/recruitment/useEmployment";

/**
 * Recruitment — the fleet view of the §391.21(b)(10) hiring file.
 *
 * The queue, not the workspace: it answers "whose file needs work" and hands off to the driver page
 * to do it, the same split the qualification file uses (D1/D3). The gap arithmetic is computed by the
 * API from `employmentCoverage`, the SAME pure function the driver page calls — a second
 * approximation here is how a fleet table and a detail page come to disagree about one driver.
 */
const router = useRouter();
const rosterQ = useRecruitmentRosterQuery();

const PAGE_SIZE = 25;
const search = ref("");
const filter = ref("all");
const page = ref(1);

const FILTERS = [
  { value: "all", label: "All drivers" },
  { value: "attention", label: "Needs attention" },
  { value: "nothing", label: "Nothing recorded" },
  { value: "inquiries", label: "Inquiries outstanding" },
];

const rows = computed(() => {
  const all = rosterQ.data.value ?? [];
  const q = search.value.trim().toLowerCase();
  return all
    .filter((r) => (q ? r.full_name.toLowerCase().includes(q) : true))
    .filter((r) => {
      if (filter.value === "nothing") return r.employers === 0;
      if (filter.value === "inquiries") return r.inquiries_outstanding > 0;
      if (filter.value === "attention") {
        return r.employers === 0 || r.gap_days > 0 || r.inquiries_outstanding > 0;
      }
      return true;
    });
});

const paged = computed(() => rows.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));

const columns: DataTableColumn[] = [
  { key: "full_name", label: "Driver" },
  { key: "employers", label: "Employers", numeric: true },
  { key: "gap_days", label: "Unexplained gap", numeric: true },
  { key: "inquiries", label: "Safety-history inquiries" },
  { key: "screening", label: "Screening identity" },
];

/**
 * One driver's headline. "Nothing recorded" is a distinct state from "recorded and has a gap" — an
 * empty file is a transcription that has not happened, and a gap is a question for the applicant.
 */
function fileBadge(r: { employers: number; gap_days: number }): { label: string; tone: string } {
  if (r.employers === 0) return { label: "Nothing recorded", tone: "neutral" };
  if (r.gap_days > 0) return { label: `${r.gap_days}d gap`, tone: "warning" };
  return { label: "Covered", tone: "success" };
}

function openDriver(id: string): void {
  void router.push({ name: "driver-detail", params: { id }, query: { section: "employment" } });
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Employment history declared on the application, and the §391.23(a)(2) inquiries it obliges" />

    <FilterBar v-model:search="search" search-placeholder="Search drivers…" :count="rows.length" count-label="drivers">
      <FilterSelect v-model="filter" label="Show" :options="FILTERS" />
    </FilterBar>

    <BaseCard padding="none">
      <DataTable
        :columns="columns"
        :rows="paged"
        row-key="driver_id"
        :loading="rosterQ.isLoading.value"
        :error="rosterQ.isError.value ? (rosterQ.error.value?.message ?? 'Could not load recruitment.') : null"
        :retrying="rosterQ.isFetching.value"
        empty-text="No drivers match this filter."
        :row-class="() => 'cursor-pointer'"
        @row-click="(row: { driver_id: string }) => openDriver(row.driver_id)"
      >
        <template #cell-full_name="{ row }">
          <span class="font-medium text-ink">{{ row.full_name }}</span>
          <span v-if="row.hire_date" class="ml-2 text-xs text-ink-muted">hired {{ row.hire_date }}</span>
        </template>
        <template #cell-employers="{ row }">
          {{ row.employers_in_window }}<span class="text-ink-muted"> in window</span>
        </template>
        <template #cell-gap_days="{ row }">
          <span :class="[BADGE_BASE, toneClass(fileBadge(row).tone)]">{{ fileBadge(row).label }}</span>
        </template>
        <template #cell-inquiries="{ row }">
          <span v-if="row.inquiries_outstanding > 0" :class="[BADGE_BASE, toneClass('danger')]">
            {{ row.inquiries_outstanding }} not sent
          </span>
          <span v-else-if="row.inquiries_awaiting > 0" :class="[BADGE_BASE, toneClass('warning')]">
            {{ row.inquiries_awaiting }} awaiting
          </span>
          <span v-else-if="row.employers_in_window > 0" :class="[BADGE_BASE, toneClass('success')]">Complete</span>
          <span v-else class="text-ink-muted">—</span>
        </template>
        <!-- Whether the driver can be screened at all (PSP, MVR, Clearinghouse) — the value itself
             never leaves the roster API, only whether it is on file. -->
        <template #cell-screening="{ row }">
          <span v-if="row.date_of_birth_recorded" :class="[BADGE_BASE, toneClass('success')]">Ready</span>
          <span v-else :class="[BADGE_BASE, toneClass('caution')]">No date of birth</span>
        </template>
        <template #footer>
          <TablePagination v-model:page="page" :total="rows.length" :page-size="PAGE_SIZE" />
        </template>
      </DataTable>
    </BaseCard>
  </div>
</template>
