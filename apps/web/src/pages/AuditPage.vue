<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useAuditQuery, type AuditFilters } from "@/features/audit/useAudit";
import TablePagination from "@/components/TablePagination.vue";

const PAGE_SIZE = 20;
const filters = ref<AuditFilters>({});
const actionInput = ref("");
const { data: logs, isLoading, isError, error } = useAuditQuery(filters);

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
    <div class="flex items-center gap-2">
      <input
        v-model="actionInput"
        placeholder="Filter by action (e.g. invite, anomaly, threshold)"
        class="w-72 rounded-md border-0 px-3 py-1.5 text-sm text-gray-900 ring-1 ring-gray-300 ring-inset"
        @keyup.enter="applyFilter"
      />
      <button class="rounded-md bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200" @click="applyFilter">
        Filter
      </button>
    </div>

    <div class="overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-gray-200">
      <div v-if="isLoading" class="px-6 py-10 text-sm text-gray-500">Loading audit log…</div>
      <div v-else-if="isError" class="px-6 py-10 text-sm text-red-600">
        {{ error instanceof Error ? error.message : "Failed to load audit log" }}
      </div>
      <div v-else-if="!logs || logs.length === 0" class="px-6 py-10 text-center text-sm text-gray-500">
        No audit entries.
      </div>
      <div v-else class="overflow-x-auto">
      <table class="min-w-full divide-y divide-gray-200 whitespace-nowrap text-sm">
        <thead class="sticky top-16 z-10 bg-gray-50 text-left text-gray-500">
          <tr>
            <th scope="col" class="px-6 py-3 font-medium min-w-[11rem]">When</th>
            <th scope="col" class="px-6 py-3 font-medium min-w-[10rem]">Action</th>
            <th scope="col" class="px-6 py-3 font-medium min-w-[10rem]">Entity</th>
            <th scope="col" class="px-6 py-3 font-medium min-w-[24rem]">Details</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr v-for="l in pageRows" :key="l.id" class="hover:bg-gray-50">
            <td class="px-6 py-3 whitespace-nowrap text-gray-500">{{ fmt(l.created_at) }}</td>
            <td class="px-6 py-3 font-mono text-xs text-gray-900">{{ l.action }}</td>
            <td class="px-6 py-3 text-gray-700">{{ l.entity ?? "—" }}</td>
            <td class="px-6 py-3 text-gray-500">{{ Object.keys(l.meta || {}).length ? JSON.stringify(l.meta) : "—" }}</td>
          </tr>
        </tbody>
      </table>
      </div>
      <TablePagination
        v-if="!isLoading && !isError && total > 0"
        :page="page"
        :page-size="PAGE_SIZE"
        :total="total"
        @update:page="page = $event"
      />
    </div>
  </div>
</template>
