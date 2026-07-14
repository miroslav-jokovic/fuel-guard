<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useAuditQuery, type AuditFilters } from "@/features/audit/useAudit";
import TablePagination from "@/components/TablePagination.vue";
import BaseButton from "@/components/ui/BaseButton.vue";
import BaseInput from "@/components/ui/BaseInput.vue";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";

const PAGE_SIZE = 20;
const filters = ref<AuditFilters>({});
const actionInput = ref("");
const { data: logs, isLoading, isError, error, isFetching, refetch } = useAuditQuery(filters);

const page = ref(1);
watch(filters, () => (page.value = 1), { deep: true });
const total = computed(() => logs.value?.length ?? 0);
const pageRows = computed(() => (logs.value ?? []).slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));

function applyFilter() {
  filters.value = { action: actionInput.value.trim() || undefined };
}

const fmt = (iso: string) => new Date(iso).toLocaleString();

const columns: DataTableColumn[] = [
  { key: "created_at", label: "When", headerClass: "min-w-[11rem]", cellClass: "text-ink-muted" },
  { key: "action", label: "Action", headerClass: "min-w-[10rem]", cellClass: "font-mono text-xs text-ink" },
  { key: "entity", label: "Entity", headerClass: "min-w-[10rem]", cellClass: "text-ink-secondary" },
  { key: "meta", label: "Details", headerClass: "min-w-[24rem]", cellClass: "text-ink-muted" },
];
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
      <BaseInput
        v-model="actionInput"
        placeholder="Filter by action (e.g. invite, anomaly, threshold)"
        class="sm:w-72"
        @keyup.enter="applyFilter"
      />
      <BaseButton variant="soft" size="sm" @click="applyFilter">Filter</BaseButton>
    </div>

    <DataTable
      :columns="columns"
      :rows="pageRows"
      row-key="id"
      :loading="isLoading"
      :error="isError ? (error instanceof Error ? error.message : 'Failed to load audit log') : null"
      :retrying="isFetching"
      empty-text="No audit entries."
      @retry="refetch"
    >
      <template #cell-created_at="{ value }">{{ fmt(value) }}</template>
      <template #cell-meta="{ row }">
        <template v-if="Object.keys(row.meta || {}).length">{{ JSON.stringify(row.meta) }}</template>
        <span v-else class="text-ink-subtle">—</span>
      </template>
      <template #footer>
        <TablePagination
          v-if="total > 0"
          :page="page"
          :page-size="PAGE_SIZE"
          :total="total"
          @update:page="page = $event"
        />
      </template>
    </DataTable>
  </div>
</template>
