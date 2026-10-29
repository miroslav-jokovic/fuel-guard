<script setup lang="ts">
import { computed, watch } from "vue";
import {
  useQueryState,
  DataWorkspace,
  FilterBar,
  DataTable,
  type DataTableColumn,
  TablePagination,
} from "@silvicom/ui";
import { usd2 } from "@silvicom/shared";
import { formatDate } from "@/lib/format";
import { PURCHASES_PAGE_SIZE, usePurchasesQuery } from "./usePurchases";

/**
 * Equipment › Invoices — what the shop paid for its tablets and truck gear (M10b, §7a.4; Q-MX10).
 * One row per invoice: date, vendor, number, total, how many items it paid for, and whether its paper
 * is filed. A row opens the invoice (`?invoice=<id>`, `AssetsPage.vue` owns the drawer).
 *
 * Live invoices only: a corrected one is reached from its correction, never listed beside it — two
 * rows for one bill would count its money twice on a page somebody adds up (`purchases.ts`).
 *
 * The search is the API's (vendor or invoice number), for `EquipmentInventoryPanel.vue`'s reason: a
 * filter over the fifty rows on screen says "no such invoice" about one on page two. Newest first by
 * the invoice's own date; the columns do not sort, for the same reason.
 */

const emit = defineEmits<{ open: [id: string] }>();

const qs = useQueryState();
const search = qs.param("search");
const page = qs.page();
watch(search, () => (page.value = 1));

const purchases = usePurchasesQuery(computed(() => ({ search: search.value.trim() || undefined, page: page.value })));

const COLUMNS: DataTableColumn[] = [
  { key: "invoiceDate", label: "Date", card: "meta", width: "sm", cellClass: "text-ink-secondary" },
  { key: "vendor", label: "Vendor", card: "title" },
  { key: "invoiceNumber", label: "Invoice number", card: "sentence", cellClass: "font-mono text-xs text-ink" },
  { key: "total", label: "Total", card: "meta", numeric: true, cellClass: "text-ink" },
  { key: "itemCount", label: "Items", card: "none", numeric: true, cellClass: "text-ink-secondary" },
  { key: "paperCount", label: "Paper", card: "none", cellClass: "text-ink-secondary" },
];
</script>

<template>
  <DataWorkspace>
    <FilterBar
      v-model:search="search"
      embedded
      search-placeholder="Search vendor or invoice number…"
      :count="purchases.data.value?.total ?? 0"
      count-label="invoices"
      :active-count="search.trim() ? 1 : 0"
      @clear-all="search = ''"
    />

    <DataTable
      embedded
      :columns="COLUMNS"
      :rows="purchases.data.value?.purchases ?? []"
      :loading="purchases.isLoading.value"
      :error="purchases.isError.value ? 'Could not load the invoices.' : null"
      :row-class="() => 'cursor-pointer'"
      @row-click="(row) => emit('open', String(row.id))"
      @retry="() => purchases.refetch()"
    >
      <template #cell-invoiceDate="{ value }">{{ formatDate(String(value)) }}</template>
      <template #cell-total="{ value }">{{ usd2(Number(value)) }}</template>
      <template #cell-paperCount="{ value }">
        <span v-if="Number(value) > 0">Filed</span>
        <span v-else class="text-ink-tertiary">Not filed</span>
      </template>
      <template #empty>
        <p v-if="search">No invoice matches that. Try the vendor's name or the number printed on it.</p>
        <p v-else>
          No invoices yet. Add one with its paper and the items it paid for — a box of ten tablets is one
          invoice.
        </p>
      </template>
      <template #footer>
        <TablePagination
          :page="page"
          :page-size="PURCHASES_PAGE_SIZE"
          :total="purchases.data.value?.total ?? 0"
          @update:page="page = $event"
        />
      </template>
    </DataTable>
  </DataWorkspace>
</template>
