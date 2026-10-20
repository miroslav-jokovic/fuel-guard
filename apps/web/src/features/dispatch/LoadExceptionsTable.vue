<script setup lang="ts">
/**
 * The Loads page's Exceptions queue (D-L2): its own feed, not a filter over the loads list, because
 * most of its sources exist only as events and have no row on the board at all. Moved out of
 * `DispatchLoadsPage.vue` when the Delivered filters and the Activity view (LOADS-ACTIVITY-PLAN) took
 * the page to its file budget. The page still owns the scope, the search and the page number, so a
 * tab change keeps them.
 */
import { EXCEPTION_LABELS, type DispatchException } from "@silvicom/shared";
import { AppButton as BaseButton, DataTable, TablePagination, type DataTableColumn } from "@silvicom/ui";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import { useResolveException } from "./useDispatchLoads";
import { BADGE_BASE, toneClass } from "@/lib/badges";

defineProps<{
  rows: DispatchException[];
  total: number;
  page: number;
  pageSize: number;
  loading: boolean;
  failed: boolean;
  fetching: boolean;
  emptyText: string;
  at: (iso: string | null | undefined) => string;
}>();
const emit = defineEmits<{ retry: []; "update:page": [page: number] }>();

const session = useSessionStore();
const toast = useToastStore();
const resolveException = useResolveException();

const COLUMNS: DataTableColumn[] = [
  { key: "kind", label: "What happened", width: "lg" },
  { key: "summary", label: "Detail", width: "3xl" },
  { key: "driver_name", label: "Driver", width: "lg" },
  { key: "occurred_at", label: "When", width: "lg" },
];

const ACTION_LABELS: Record<string, string> = {
  review_diff: "Review & clear",
  adopt_equipment: "Adopt equipment",
  acknowledge: "Acknowledge",
  reassign: "Reassign",
};

async function clearException(row: DispatchException) {
  if (!session.can("dispatch") || !row.load_id) return;
  try {
    await resolveException.mutateAsync({
      loadId: row.load_id,
      body: { event_id: row.id.includes(":") ? null : row.id, kind: row.kind, action: row.action },
    });
    toast.success("Exception cleared");
  } catch (e) {
    toast.error("Could not clear that exception", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <DataTable
    :columns="COLUMNS"
    :rows="rows"
    row-key="id"
    :loading="loading"
    :error="failed ? 'Could not load the exceptions.' : null"
    :retrying="fetching"
    :empty-text="emptyText"
    embedded
    @retry="emit('retry')"
  >
    <template #cell-kind="{ row }">
      <span :class="[BADGE_BASE, toneClass(row.kind === 'declined' ? 'danger' : 'warning')]">
        {{ EXCEPTION_LABELS[row.kind as keyof typeof EXCEPTION_LABELS] }}
      </span>
    </template>
    <template #cell-summary="{ row }">
      <BaseButton v-if="row.load_id" variant="link" :to="{ name: 'load-detail', params: { id: row.load_id } }" class="font-medium">
        {{ row.summary }}
      </BaseButton>
      <span v-else class="text-ink-secondary">{{ row.summary }}</span>
    </template>
    <template #cell-occurred_at="{ row }">{{ at(row.occurred_at) }}</template>
    <template #actions="{ row }">
      <BaseButton
        v-if="session.can('dispatch') && row.load_id"
        variant="ghost"
        size="sm"
        :disabled="resolveException.isPending.value"
        @click.stop="clearException(row)"
      >
        {{ ACTION_LABELS[row.action] ?? "Acknowledge" }}
      </BaseButton>
    </template>
    <template #footer>
      <TablePagination :page="page" :page-size="pageSize" :total="total" :loading="fetching" @update:page="emit('update:page', $event)" />
    </template>
  </DataTable>
</template>
