<script setup lang="ts">
import { computed, ref } from "vue";
import { DQ_ITEMS, type DqExportRow } from "@silvicom/shared";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import { AppButton as BaseButton } from "@silvicom/ui";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { formatDate, formatDateTime } from "@/lib/format";
import { useToastStore } from "@/stores/toast";
import { openBinder, useExportsQuery } from "@/composables/useDqExports";

/**
 * What has left the building (D-BD9).
 *
 * Every binder and every single document released is a row here: who asked, for which drivers, as at
 * what date. The download disappears after seven days and the ROW does not — a record of who pulled
 * a medical card out of the system costs nothing to keep and is exactly what you want six months
 * later, which is why the expired rows stay in the list rather than being tidied away.
 */
const query = useExportsQuery();
const toast = useToastStore();
const opening = ref<string | null>(null);

const STATUS_TONE: Record<DqExportRow["status"], string> = {
  queued: "neutral",
  running: "info",
  done: "success",
  failed: "danger",
};
const STATUS_LABEL: Record<DqExportRow["status"], string> = {
  queued: "queued",
  running: "assembling",
  done: "ready",
  failed: "failed",
};

const requirementLabel = (key: string | null): string =>
  key ? (DQ_ITEMS.find((i) => i.key === key)?.label ?? key) : "";

interface Row extends DqExportRow {
  what: string;
  who: string;
  when: string;
  detail: string;
}

const rows = computed<Row[]>(() =>
  (query.data.value ?? []).map((e) => ({
    ...e,
    as_at: formatDate(e.as_at),
    what:
      e.kind === "document"
        ? `${requirementLabel(e.requirement_key)} — ${e.driver_names[0] ?? "unknown driver"}`
        : e.driver_names.length === 1
          ? `Qualification file — ${e.driver_names[0]}`
          : `Qualification files — ${e.driver_names.length} drivers`,
    who: e.requested_by_email ?? "—",
    when: formatDateTime(e.created_at),
    detail:
      e.status === "failed"
        ? (e.error ?? "No reason recorded.")
        : e.status === "done"
          ? `${e.pages ?? 0} pages · ${e.documents_count ?? 0} scans · ${e.gaps_count ?? 0} gaps`
          : "",
  })),
);

const columns: DataTableColumn[] = [
  {
    key: "what",
    label: "Exported",
    width: "2xl",
    cellClass: "font-medium text-ink",
  },
  { key: "as_at", label: "As at", headerClass: "w-28", cellClass: "text-ink-secondary" },
  { key: "who", label: "By", width: "xl", cellClass: "text-ink-secondary" },
  { key: "when", label: "Requested", headerClass: "w-40", cellClass: "text-ink-secondary" },
  { key: "status", label: "Status", headerClass: "w-32" },
];

async function open(row: Row): Promise<void> {
  opening.value = row.id;
  try {
    await openBinder(row.id);
  } catch (e) {
    toast.error("Could not open the binder", e instanceof Error ? e.message : undefined);
  }
  opening.value = null;
}
</script>

<template>
  <DataTable
    :columns="columns"
    :rows="rows"
    row-key="id"
    :loading="query.isLoading.value"
    :error="
      query.isError.value
        ? (query.error.value?.message ?? 'Could not load the export history.')
        : null
    "
    :retrying="query.isFetching.value"
    empty-text="Nothing has been exported yet. Select drivers on the All drivers tab to build a binder."
    @retry="query.refetch()"
  >
    <template #cell-what="{ row }">
      <span class="text-ink">{{ row.what }}</span>
      <span v-if="row.detail" class="mt-0.5 block text-xs text-ink-tertiary">{{ row.detail }}</span>
    </template>
    <template #cell-status="{ row }">
      <span :class="[BADGE_BASE, toneClass(STATUS_TONE[row.status])]">{{
        STATUS_LABEL[row.status]
      }}</span>
      <span v-if="row.purged" class="mt-0.5 block text-xs text-ink-tertiary"
        >file removed after 7 days</span
      >
    </template>
    <template #actions="{ row }">
      <BaseButton
        v-if="row.downloadable"
        variant="ghost"
        size="sm"
        :disabled="opening === row.id"
        @click.stop="open(row)"
      >
        {{ opening === row.id ? "Opening…" : "Download" }}
      </BaseButton>
      <span v-else-if="row.kind === 'document'" class="text-xs text-ink-tertiary"
        >sent at the time</span
      >
      <span v-else-if="row.purged" class="text-xs text-ink-tertiary">generate again</span>
    </template>
  </DataTable>
</template>
