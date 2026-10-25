<script setup lang="ts">
import { AppButton as BaseButton } from "@silvicom/ui";
import type { PendingLine } from "./useChat";

/**
 * A line you sent that the server has not confirmed ("Sending…"), or refused — which keeps its text,
 * with Retry, so nothing typed is ever lost (D-CHAT2's optimistic send). The same in a conversation, a
 * channel and a reply pane (CH5c).
 */
defineProps<{ line: PendingLine }>();
defineEmits<{ retry: [line: PendingLine] }>();
</script>

<template>
  <div class="ml-auto max-w-[75%] rounded-surface bg-action-primary px-3 py-2 text-sm text-action-primary-foreground opacity-80">
    <div class="whitespace-pre-wrap break-words">{{ line.body }}</div>
    <div class="mt-0.5 text-right text-2xs">
      <template v-if="line.state === 'pending'">Sending…</template>
      <template v-else>
        Not sent — {{ line.error }}
        <BaseButton size="sm" variant="ghost" @click="$emit('retry', line)">Retry</BaseButton>
      </template>
    </div>
  </div>
</template>
