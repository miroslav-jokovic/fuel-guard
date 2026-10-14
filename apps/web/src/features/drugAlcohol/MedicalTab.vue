<script setup lang="ts">
import { computed } from "vue";
import { MEDICAL_SOURCES, MEDICAL_SOURCE_LABEL, type MedicalCardRow, type MedicalCards, type MedicalSource } from "@silvicom/shared";
import { AppCard as BaseCard } from "@silvicom/ui";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import PersonCell from "@/features/drugAlcohol/PersonCell.vue";
import TablePagination from "@/components/TablePagination.vue";
import { useClientPage } from "@/composables/useClientPage";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { formatDate } from "@/lib/format";

/**
 * Medical cards (MEDSTOP-PLAN.md §7A.3, UX2). The date on every row is the one the qualification
 * file keeps by the owner's rule (Q-MSUX7, 2026-10-13): a scanned card wins; without one, the
 * earliest date McLeod or Med-Stop gives. The second list is the rule's "flagged for review" — every
 * working driver whose sources disagree, each source's date beside it (D-MSUX4b). One column per
 * source, from `MEDICAL_SOURCES`, so Samba is a column the day it is connected (Q-MSUX6).
 */
const props = defineProps<{ medical: MedicalCards }>();

const sourceColumns: DataTableColumn[] = MEDICAL_SOURCES.map((s) => ({ key: `src-${s}`, label: MEDICAL_SOURCE_LABEL[s] }));
const dueColumns: DataTableColumn[] = [
  { key: "name", label: "Driver", cellClass: "font-medium text-ink" },
  { key: "expiresOn", label: "Expires" },
  { key: "daysLeft", label: "Days left", numeric: true },
  { key: "basis", label: "Date from" },
];
const disagreeColumns: DataTableColumn[] = [
  { key: "name", label: "Driver", cellClass: "font-medium text-ink" },
  { key: "expiresOn", label: "File keeps" },
  { key: "basis", label: "Because" },
  ...sourceColumns,
];

const asRows = (rows: MedicalCardRow[]) => rows.map((r) => ({ ...r, name: r.person.name, key: r.person.driverId }));
const due = computed(() => asRows(props.medical.due));
const disagree = computed(() => asRows(props.medical.disagree));
// Paged (F26): both lists are one response with no bound but the fleet's size.
const duePage = useClientPage(due);
const disagreePage = useClientPage(disagree);

const tone = (days: number) => (days < 0 ? "danger" : days <= 30 ? "warning" : "neutral");
const sourceDate = (row: MedicalCardRow, s: MedicalSource) => row.sources.find((c) => c.source === s)?.expiresOn ?? null;
const basis = (row: MedicalCardRow) =>
  row.documented ? "Scanned card on file" : row.disagree ? "Earliest of the sources" : "All sources agree";
</script>

<template>
  <div class="space-y-6">
    <BaseCard as="section" padding="none">
      <div class="px-6 pt-5 pb-3">
        <h2 class="text-sm font-semibold text-ink">Medical cards expiring in the next 60 days</h2>
        <p class="mt-1 text-xs text-ink-muted">
          A driver may not drive on an expired card. The date is the one the qualification file keeps: a scanned card wins; otherwise the earliest date McLeod or Med-Stop gives.
        </p>
      </div>
      <DataTable embedded dense :sticky-header="false" :columns="dueColumns" :rows="duePage.pageRows.value" row-key="key" empty-text="No medical card expires in the next 60 days.">
        <template #cell-name="{ row }"><PersonCell :person="row.person" /></template>
        <template #cell-expiresOn="{ row }">{{ formatDate(row.expiresOn) }}</template>
        <template #cell-daysLeft="{ row }">
          <span :class="[BADGE_BASE, toneClass(tone(row.daysLeft))]">{{ row.daysLeft < 0 ? `Expired ${-row.daysLeft} d ago` : row.daysLeft === 0 ? "Today" : `${row.daysLeft} d` }}</span>
        </template>
        <template #cell-basis="{ row }">{{ basis(row) }}</template>
        <template v-if="duePage.paged.value" #footer>
          <TablePagination
            :page="duePage.page.value"
            :page-size="duePage.pageSize"
            :total="duePage.total.value"
            @update:page="duePage.page.value = $event"
          />
        </template>
      </DataTable>
    </BaseCard>

    <BaseCard as="section" padding="none">
      <div class="px-6 pt-5 pb-3">
        <h2 class="text-sm font-semibold text-ink">Sources disagree</h2>
        <p class="mt-1 text-xs text-ink-muted">
          Check the driver's card. Filing its scan in the qualification file settles it — a scanned card wins over every source.
        </p>
      </div>
      <DataTable embedded dense :sticky-header="false" :columns="disagreeColumns" :rows="disagreePage.pageRows.value" row-key="key" empty-text="Every source agrees on every working driver's medical card.">
        <template #cell-name="{ row }"><PersonCell :person="row.person" /></template>
        <template #cell-expiresOn="{ row }">{{ formatDate(row.expiresOn) }}</template>
        <template #cell-basis="{ row }">{{ basis(row) }}</template>
        <template v-for="s in MEDICAL_SOURCES" :key="s" #[`cell-src-${s}`]="{ row }">
          {{ sourceDate(row, s) ? formatDate(sourceDate(row, s)!) : "—" }}
        </template>
        <template v-if="disagreePage.paged.value" #footer>
          <TablePagination
            :page="disagreePage.page.value"
            :page-size="disagreePage.pageSize"
            :total="disagreePage.total.value"
            @update:page="disagreePage.page.value = $event"
          />
        </template>
      </DataTable>
    </BaseCard>
  </div>
</template>
