<script setup lang="ts">
import { ref } from "vue";
import { CHAT_COMPLIANCE_REASON_LABELS, CHAT_EXPORT_FILE_DAYS, type ChatExport, type ChatExportLinksResponse } from "@silvicom/shared";
import { AppBadge, AppButton as BaseButton, DataTable, type DataTableColumn } from "@silvicom/ui";
import { formatDateTime } from "@/lib/format";
import { exportLinks, useComplianceExportsQuery, type RunAct } from "./useChatCompliance";

/**
 * Every export of the org's chat (OFFICE-CHAT-PLAN CHA3, D-CHAT20): who took which words out, why, and
 * the ledger position the copy is tied to. An export is made from a conversation's window or from a
 * messages search; this list is where its files are fetched. The files are kept for
 * `CHAT_EXPORT_FILE_DAYS` days; the row stays for good, so a removed export still says what it held.
 *
 * Getting the files asks for the password like reading does — they are the words — and returns links
 * that work for five minutes.
 */
const props = defineProps<{ run: RunAct }>();

const exportsQuery = useComplianceExportsQuery();
const links = ref<Record<string, ChatExportLinksResponse>>({});

async function files(e: ChatExport) {
  await props.run(async () => {
    links.value = { ...links.value, [e.id]: await exportLinks(e.id) };
  });
}

const columns: DataTableColumn[] = [
  { key: "created_at", label: "Made", width: "xl" },
  { key: "scope", label: "Of", width: "xl" },
  { key: "reason", label: "Why", width: "2xl" },
  { key: "status", label: "Files", width: "xl" },
];
const what = (e: ChatExport) => {
  if (e.scope === "conversation") return e.thread_subject?.trim() || "One conversation";
  const f = e.filters as { q?: string };
  return f.q ? `Search for “${f.q}”` : "A search";
};
</script>

<template>
  <div class="space-y-3">
    <p class="text-sm text-ink-muted">
      To export, open a conversation and choose “Export”, or search the messages and choose “Export these results”. Each
      export is a PDF to read, the messages as JSONL, and a manifest that ties both to the chat record. Files are kept for
      {{ CHAT_EXPORT_FILE_DAYS }} days.
    </p>
    <DataTable
      :columns="columns"
      :rows="exportsQuery.data.value?.exports ?? []"
      row-key="id"
      :loading="exportsQuery.isPending.value"
      :error="exportsQuery.isError.value ? 'Could not load the exports.' : null"
      :retrying="exportsQuery.isFetching.value"
      empty-text="Nothing has been exported."
      @retry="exportsQuery.refetch()"
    >
      <template #cell-created_at="{ row }">
        <div>{{ formatDateTime(row.created_at) }}</div>
        <div class="text-xs text-ink-muted">by {{ row.requested_by_name ?? "someone" }}</div>
      </template>
      <template #cell-scope="{ row }">
        <div class="text-ink">{{ what(row) }}</div>
        <div class="text-xs text-ink-muted">{{ row.message_count }} message{{ row.message_count === 1 ? "" : "s" }} · record entry {{ row.ledger_seq }}</div>
      </template>
      <template #cell-reason="{ row }">
        <div class="text-ink">{{ CHAT_COMPLIANCE_REASON_LABELS[row.reason.category] }}</div>
        <div class="text-xs text-ink-muted">{{ row.reason.text }}</div>
      </template>
      <template #cell-status="{ row }">
        <AppBadge v-if="row.status === 'failed'" tone="danger">Failed</AppBadge>
        <AppBadge v-else-if="row.status === 'building'" tone="info">Being written</AppBadge>
        <AppBadge v-else-if="row.purged_at" tone="neutral">Files removed</AppBadge>
        <template v-else-if="links[row.id]">
          <div class="flex flex-wrap gap-x-3 text-sm">
            <a :href="links[row.id]!.links.pdf" target="_blank" rel="noopener" class="text-link hover:text-link-hover">PDF</a>
            <a :href="links[row.id]!.links.jsonl" target="_blank" rel="noopener" class="text-link hover:text-link-hover">JSONL</a>
            <a :href="links[row.id]!.links.manifest" target="_blank" rel="noopener" class="text-link hover:text-link-hover">Manifest</a>
          </div>
          <div class="text-xs text-ink-muted">Links work for five minutes</div>
        </template>
        <template v-else>
          <BaseButton size="sm" @click="files(row)">Get the files</BaseButton>
          <div v-if="row.expires_at" class="mt-1 text-xs text-ink-muted">until {{ formatDateTime(row.expires_at) }}</div>
        </template>
      </template>
    </DataTable>
  </div>
</template>
