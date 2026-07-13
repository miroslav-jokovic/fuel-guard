<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useAuditQuery, type AuditFilters } from "@/features/audit/useAudit";
import TablePagination from "@/components/TablePagination.vue";
import BaseButton from "@/components/ui/BaseButton.vue";
import BaseInput from "@/components/ui/BaseInput.vue";
import DataTable from "@/components/ui/DataTable.vue";

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
      :loading="isLoading"
      :error="isError ? (error instanceof Error ? error.message : 'Failed to load audit log') : null"
      :retrying="isFetching"
      :empty="!logs || logs.length === 0"
      empty-text="No audit entries."
      :skeleton-cols="4"
      @retry="refetch"
    >
      <template #head>
        <tr>
          <th scope="col" class="px-6 py-3 font-medium min-w-[11rem]">When</th>
          <th scope="col" class="px-6 py-3 font-medium min-w-[10rem]">Action</th>
          <th scope="col" class="px-6 py-3 font-medium min-w-[10rem]">Entity</th>
          <th scope="col" class="px-6 py-3 font-medium min-w-[24rem]">Details</th>
        </tr>
      </template>
      <tr v-for="l in pageRows" :key="l.id" class="hover:bg-surface-subtle">
        <td class="px-6 py-3 text-ink-muted">{{ fmt(l.created_at) }}</td>
        <td class="px-6 py-3 font-mono text-xs text-ink">{{ l.action }}</td>
        <td class="px-6 py-3 text-ink-secondary">{{ l.entity ?? "—" }}</td>
        <td class="px-6 py-3 text-ink-muted">{{ Object.keys(l.meta || {}).length ? JSON.stringify(l.meta) : "—" }}</td>
      </tr>
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
