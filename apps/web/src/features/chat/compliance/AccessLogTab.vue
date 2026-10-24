<script setup lang="ts">
import { computed, ref } from "vue";
import { CHAT_COMPLIANCE_ACTION_LABELS, chatComplianceReasonLine, type ChatComplianceAccessRow } from "@silvicom/shared";
import { AppButton as BaseButton, DataTable, type DataTableColumn } from "@silvicom/ui";
import { formatDateTime } from "@/lib/format";
import { useComplianceAccessLogQuery } from "./useChatCompliance";

/**
 * Who looked, when, at what and why — every compliance act in the org's chat ledger, newest first
 * (OFFICE-CHAT-PLAN §5.2). This is the control in place of a second approval (Q-CHAT11): every holder
 * of the permission sees every other holder's searches and openings, reason included.
 */
const beforeSeq = ref<number | null>(null);
const pages = ref<ChatComplianceAccessRow[]>([]);
const page = useComplianceAccessLogQuery(beforeSeq);
const rows = computed(() => [...pages.value, ...(page.data.value?.rows ?? [])]);

function older() {
  const next = page.data.value?.before_seq;
  if (!next) return;
  pages.value = rows.value;
  beforeSeq.value = next;
}

const columns: DataTableColumn[] = [
  { key: "occurred_at", label: "When", width: "lg" },
  { key: "actor_name", label: "Who", width: "lg" },
  { key: "action", label: "Did what", width: "lg" },
  { key: "detail", label: "Why, and what for", width: "3xl" },
];
const what = (r: ChatComplianceAccessRow): string => {
  const d = r.detail as { scope?: string; filters?: Record<string, unknown>; before_seq?: number | null; matter?: string; message_count?: number };
  const parts: string[] = [];
  if (d.matter) parts.push(`matter ${d.matter}`);
  if (d.scope) parts.push(d.scope);
  if (typeof d.message_count === "number") parts.push(`${d.message_count} message${d.message_count === 1 ? "" : "s"}`);
  if (r.subject_name) parts.push(`about ${r.subject_name}`);
  const f = d.filters ?? {};
  if (typeof f.q === "string") parts.push(`words “${f.q}”`);
  if (typeof f.from === "string" || typeof f.to === "string") parts.push(`${f.from ? formatDateTime(String(f.from)) : "…"} – ${f.to ? formatDateTime(String(f.to)) : "…"}`);
  if (r.thread_id) parts.push(`conversation ${r.thread_id.slice(0, 8)}…`);
  if (d.before_seq) parts.push(`before line ${d.before_seq}`);
  return parts.join(", ");
};
</script>

<template>
  <DataTable
    :columns="columns"
    :rows="rows"
    row-key="seq"
    :loading="page.isPending.value"
    :error="page.isError.value ? 'Could not load the access log.' : null"
    :retrying="page.isFetching.value"
    empty-text="Nobody has looked yet."
    @retry="page.refetch()"
  >
    <template #cell-occurred_at="{ value }">{{ formatDateTime(value) }}</template>
    <template #cell-actor_name="{ value }">{{ value ?? "Not recorded" }}</template>
    <template #cell-action="{ value }">{{ CHAT_COMPLIANCE_ACTION_LABELS[value] ?? value }}</template>
    <template #cell-detail="{ row }">
      <div class="text-ink">{{ chatComplianceReasonLine(row.detail) || "—" }}</div>
      <div class="text-xs text-ink-muted">{{ what(row) }}</div>
    </template>
    <template #footer>
      <div v-if="page.data.value?.before_seq" class="flex justify-center p-3">
        <BaseButton size="sm" :disabled="page.isFetching.value" @click="older">Older</BaseButton>
      </div>
    </template>
  </DataTable>
</template>
