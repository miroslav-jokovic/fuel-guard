<script setup lang="ts">
import { AppAvatar, AppButton as BaseButton } from "@silvicom/ui";
import type { PendingLine } from "./useChat";

/**
 * A line you sent that the server has not confirmed ("Sending…"), or refused — which keeps its words,
 * with Retry, so nothing typed is ever lost (D-CHAT2's optimistic send). The same row shape as a
 * confirmed line (D-CHATUI4): it continues your run, and only its small print says it is not there yet.
 */
defineProps<{ line: PendingLine; first: boolean; viewerName: string }>();
defineEmits<{ retry: [line: PendingLine] }>();
</script>

<template>
  <div class="flex gap-3 rounded-control px-2" :class="first ? 'mt-3 py-1' : 'py-0.5'">
    <div class="w-9 shrink-0"><AppAvatar v-if="first" :label="viewerName" size="sm" class="ml-auto" /></div>
    <div class="min-w-0 flex-1 text-sm">
      <div v-if="first" class="flex items-baseline gap-2"><span class="truncate font-semibold text-ink">{{ viewerName }}</span></div>
      <p class="whitespace-pre-wrap break-words" :class="line.state === 'failed' ? 'text-ink' : 'text-ink-muted'">{{ line.body }}</p>
      <p v-if="line.state === 'pending'" class="text-xs text-ink-tertiary">Sending…</p>
      <p v-else class="flex flex-wrap items-center gap-x-2 text-xs text-danger-700" role="alert">
        Not sent — {{ line.error }}
        <BaseButton size="sm" variant="link" @click="$emit('retry', line)">Retry</BaseButton>
      </p>
    </div>
  </div>
</template>
