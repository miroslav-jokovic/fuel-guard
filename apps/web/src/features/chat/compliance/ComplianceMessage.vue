<script setup lang="ts">
import { ref } from "vue";
import { CHAT_FILE_TYPES, chatFileSize, type ChatComplianceFile, type ChatComplianceMessage, type ChatComplianceReason } from "@silvicom/shared";
import { AppButton as BaseButton } from "@silvicom/ui";
import { formatDateTime } from "@/lib/format";
import { followDownload } from "../useChatFileLink";
import { fileLink, type RunAct } from "./useChatCompliance";

/**
 * One message as the console shows it: who, the words as they stand, and — marked as such — that it
 * was retracted (the words stay, §5.3) and every earlier version an edit replaced (D-CHAT13). Nothing
 * here is editable; the console changes nothing.
 *
 * Its files (0544), a retracted line's included: each with its kind, size and the start of its SHA-256 —
 * the hash its `file_attached` ledger row holds — and Save, which is a ledgered act with the console's
 * reason (`fileLink`), so it asks for the password like opening the conversation did. Shown without a
 * reason, the files are listed and nothing is offered.
 */
const props = defineProps<{ message: ChatComplianceMessage; reason?: ChatComplianceReason | null; run?: RunAct }>();
const saving = ref<string | null>(null);
const kind = (f: ChatComplianceFile) => (CHAT_FILE_TYPES as Record<string, { label: string }>)[f.mime]?.label ?? "File";

async function save(f: ChatComplianceFile) {
  const reason = props.reason;
  if (!reason || !props.run) return;
  await props.run(async () => {
    saving.value = f.id;
    try {
      followDownload((await fileLink(f.id, { reason })).url);
    } finally {
      saving.value = null;
    }
  });
}
</script>

<template>
  <div class="text-sm">
    <div class="font-semibold text-ink">{{ message.sender_name ?? "Someone" }}</div>
    <div class="whitespace-pre-wrap break-words text-ink" :class="message.deleted_at ? 'line-through opacity-80' : ''">{{ message.body }}</div>
    <div v-if="message.deleted_at" class="mt-1 text-xs text-warning-700">
      Removed by the author {{ formatDateTime(message.deleted_at) }} — the words are kept.
    </div>
    <ul v-if="message.attachments.length" class="mt-1 space-y-1" aria-label="Files">
      <li v-for="f in message.attachments" :key="f.id" class="flex items-center gap-2 rounded-surface bg-surface px-2 py-1 text-xs ring-1 ring-inset ring-edge-subtle" data-compliance-file>
        <span class="min-w-0 flex-1">
          <span class="block truncate font-medium text-ink" :title="f.file_name">{{ f.file_name }}</span>
          <span class="block text-ink-muted">{{ kind(f) }} · {{ chatFileSize(f.byte_size) }} · <span class="font-mono" :title="f.sha256">sha256 {{ f.sha256.slice(0, 12) }}…</span></span>
        </span>
        <BaseButton v-if="reason && run" size="sm" variant="ghost" :disabled="saving === f.id" @click="save(f)">{{ saving === f.id ? "Getting…" : "Save" }}</BaseButton>
      </li>
    </ul>
    <details v-if="message.versions.length" class="mt-1 text-xs text-ink-muted">
      <summary class="cursor-pointer">
        Edited {{ message.edited_at ? formatDateTime(message.edited_at) : "" }} — {{ message.versions.length }} earlier
        {{ message.versions.length === 1 ? "version" : "versions" }}
      </summary>
      <ol class="mt-1 space-y-1">
        <li v-for="v in message.versions" :key="v.version" class="rounded-surface bg-surface-subtle px-2 py-1">
          <span class="text-ink-tertiary">Version {{ v.version }}, until {{ formatDateTime(v.replaced_at) }}:</span>
          <div class="whitespace-pre-wrap break-words text-ink">{{ v.body }}</div>
        </li>
      </ol>
    </details>
  </div>
</template>
