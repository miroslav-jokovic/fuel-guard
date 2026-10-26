<script setup lang="ts">
import type { ChatComplianceMessage } from "@silvicom/shared";
import { formatDateTime } from "@/lib/format";

/**
 * One message as the console shows it: who, the words as they stand, and — marked as such — that it
 * was retracted (the words stay, §5.3) and every earlier version an edit replaced (D-CHAT13). Nothing
 * here is editable; the console changes nothing.
 */
defineProps<{ message: ChatComplianceMessage }>();
</script>

<template>
  <div class="text-sm">
    <div class="font-semibold text-ink">{{ message.sender_name ?? "Someone" }}</div>
    <div class="whitespace-pre-wrap break-words text-ink" :class="message.deleted_at ? 'line-through opacity-80' : ''">{{ message.body }}</div>
    <div v-if="message.deleted_at" class="mt-1 text-xs text-warning-700">
      Removed by the author {{ formatDateTime(message.deleted_at) }} — the words are kept.
    </div>
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
