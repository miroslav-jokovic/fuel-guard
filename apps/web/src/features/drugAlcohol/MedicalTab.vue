<script setup lang="ts">
import type { MedicalCardRow } from "@silvicom/shared";
import { AppCard as BaseCard } from "@silvicom/ui";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import PersonCell from "@/features/drugAlcohol/PersonCell.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { formatDate } from "@/lib/format";

/**
 * Medical cards (MEDSTOP-PLAN.md §7A.3, R2): working drivers whose card runs out within 60 days or
 * has, by the card on file OR Med-Stop's record. "On file" is the date the qualification file and its
 * alerts use; Med-Stop's appears only where it differs, and the earlier of the two decides the row.
 */
defineProps<{ rows: MedicalCardRow[] }>();

const columns: DataTableColumn[] = [
  { key: "name", label: "Driver", cellClass: "font-medium text-ink" },
  { key: "expiresOn", label: "Expires" },
  { key: "daysLeft", label: "Days left", numeric: true },
  { key: "ours", label: "On file" },
  { key: "medstop", label: "Med-Stop says" },
];
const tone = (days: number) => (days < 0 ? "danger" : days <= 30 ? "warning" : "neutral");
</script>

<template>
  <BaseCard as="section" padding="none">
    <div class="px-6 pt-5 pb-3">
      <h2 class="text-sm font-semibold text-ink">Medical cards expiring in the next 60 days</h2>
      <p class="mt-1 text-xs text-ink-muted">
        A driver may not drive on an expired card. Where Med-Stop's date differs from the card on file, the earlier one is shown and both dates are listed — check the card and correct the wrong one.
      </p>
    </div>
    <DataTable embedded dense :sticky-header="false" :columns="columns" :rows="rows.map((r) => ({ ...r, name: r.person.name, key: r.person.driverId }))" row-key="key" empty-text="No medical card expires in the next 60 days.">
      <template #cell-name="{ row }"><PersonCell :person="row.person" /></template>
      <template #cell-expiresOn="{ row }">{{ formatDate(row.expiresOn) }}</template>
      <template #cell-daysLeft="{ row }">
        <span :class="[BADGE_BASE, toneClass(tone(row.daysLeft))]">{{ row.daysLeft < 0 ? `Expired ${-row.daysLeft} d ago` : row.daysLeft === 0 ? "Today" : `${row.daysLeft} d` }}</span>
      </template>
      <template #cell-ours="{ row }">{{ row.ours ? formatDate(row.ours) : "None on file" }}</template>
      <template #cell-medstop="{ row }">{{ row.medstop ? formatDate(row.medstop) : "—" }}</template>
    </DataTable>
  </BaseCard>
</template>
