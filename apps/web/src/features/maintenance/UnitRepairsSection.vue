<script setup lang="ts">
import { computed, ref } from "vue";
import { AppCard as BaseCard, DataTable, TablePagination, type DataTableColumn } from "@silvicom/ui";
import type { UnitShopFileDto, UnitWorkOrderHistoryDto } from "@silvicom/shared";
import { formatDate } from "@/lib/format";
import WorkOrderRows from "./WorkOrderRows.vue";

/**
 * In the shop, and the repair history — one truck's repair RECORD from FleetPal
 * (MAINTENANCE-SECTION-REDESIGN-PROPOSAL.md §4.3; D-INV10). Three lists in one section: what is open
 * now, what an inspection found that nobody has fixed, and what was done before with how long the unit
 * was out. No money: the bill is F9b's, behind the coverage bound D-FP4 requires, and lives on the
 * Repair bills page — the history must not vanish for want of a ledger figure.
 */
const props = defineProps<{ file: UnitShopFileDto }>();

const HISTORY_COLUMNS: DataTableColumn[] = [
  { key: "when", label: "Done", card: "meta", width: "md", cellClass: "text-ink-secondary" },
  { key: "work", label: "Work", card: "title" },
  { key: "downtimeDays", label: "Days out", card: "none", numeric: true, width: "sm" },
];
/** Ten a page (contract §9 rule 9): a truck's history is years of work orders, and grows with every one. */
const PAGE_SIZE = 10;
const page = ref(1);
const history = computed(() => props.file.history as unknown as Record<string, unknown>[]);
const pageRows = computed(() => history.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));
const work = (r: UnitWorkOrderHistoryDto) => r.jobs.join(", ") || r.description || r.referenceNumber || "Work order";
</script>

<template>
  <section id="section-repairs" class="scroll-mt-6 space-y-4" data-test="unit-repairs">
    <BaseCard padding="none">
      <h2 class="border-b border-edge-subtle px-5 py-3 text-sm font-semibold text-ink">In the shop now</h2>
      <WorkOrderRows :orders="file.openWorkOrders" :empty-text="file.fleetpal.unitIds.length ? 'Nothing open in the shop for this unit.' : 'FleetPal has no unit linked to this one, so its work orders cannot be found. Link it under Settings → FleetPal.'" />
    </BaseCard>

    <BaseCard v-if="file.openDefects.length" padding="none" data-test="unit-defects">
      <h2 class="border-b border-edge-subtle px-5 py-3 text-sm font-semibold text-ink">Found on an inspection, not fixed</h2>
      <ul class="divide-y divide-edge-subtle text-sm">
        <li v-for="d in file.openDefects" :key="d.id" class="flex items-center justify-between gap-4 px-5 py-2">
          <span class="min-w-0 truncate text-ink">{{ d.name ?? d.description ?? "Defect" }}<span v-if="d.driverComment" class="text-ink-muted"> — {{ d.driverComment }}</span></span>
          <span class="shrink-0 text-xs text-ink-muted">{{ d.detectedAt ? formatDate(d.detectedAt) : "—" }}</span>
        </li>
      </ul>
    </BaseCard>

    <div class="space-y-3">
      <h2 class="text-sm font-semibold text-ink">Repair history</h2>
      <DataTable :columns="HISTORY_COLUMNS" :rows="pageRows" row-key="id" empty-text="No past work order on this unit.">
        <template #cell-when="{ row }">{{ (row as unknown as UnitWorkOrderHistoryDto).completedAt ? formatDate((row as unknown as UnitWorkOrderHistoryDto).completedAt!) : (row as unknown as UnitWorkOrderHistoryDto).openedAt ? `Opened ${formatDate((row as unknown as UnitWorkOrderHistoryDto).openedAt!)}` : "—" }}</template>
        <template #cell-work="{ row }">
          <span class="text-ink">{{ work(row as unknown as UnitWorkOrderHistoryDto) }}</span>
          <span v-if="(row as unknown as UnitWorkOrderHistoryDto).referenceNumber" class="ml-2 font-mono text-xs text-ink-muted">{{ (row as unknown as UnitWorkOrderHistoryDto).referenceNumber }}</span>
        </template>
        <template #cell-downtimeDays="{ value }">{{ value ?? "—" }}</template>
        <template #empty><p>No past work order on this unit.</p></template>
        <template #footer>
          <TablePagination :page="page" :page-size="PAGE_SIZE" :total="history.length" @update:page="page = $event" />
        </template>
      </DataTable>
    </div>
  </section>
</template>
