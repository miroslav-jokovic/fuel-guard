<script setup lang="ts">
import { chatPreview, chatTitle, type ChatConversation } from "@silvicom/shared";
import { AppButton as BaseButton } from "@silvicom/ui";
import { chatRowTime } from "./chatTime";

/**
 * The left column of /chat: every conversation the person is in, newest activity first (the order
 * the API returns, D-CHAT5). A row shows who or what it is, the last line and an unread count; a
 * muted conversation keeps its count but never bolds (Teams' muted section is CH6).
 */
defineProps<{ conversations: ChatConversation[]; selectedId: string | null }>();
defineEmits<{ open: [id: string] }>();
</script>

<template>
  <ul class="divide-y divide-edge-subtle" aria-label="Conversations">
    <li v-for="c in conversations" :key="c.thread_id">
      <!-- `size="row"` + `block`: the sanctioned full-width, left-aligned list row (AppButton). The
           browser pass found the default control shape squeezing both lines onto one, cut off. -->
      <BaseButton
        type="button"
        size="row"
        block
        :variant="selectedId === c.thread_id ? 'soft' : 'ghost'"
        class="px-4 py-3"
        :aria-current="selectedId === c.thread_id ? 'true' : undefined"
        @click="$emit('open', c.thread_id)"
      >
        <span class="block w-full min-w-0">
          <span class="flex items-center justify-between gap-2">
            <span
              class="truncate text-sm text-ink"
              :class="c.unread > 0 && c.muted !== 'all' ? 'font-semibold' : 'font-medium'"
            >{{ chatTitle(c) }}</span>
            <span class="shrink-0 text-xs tabular-nums text-ink-muted">{{ chatRowTime(c.last_message_at) }}</span>
          </span>
          <span class="mt-0.5 flex items-center justify-between gap-2">
            <span class="truncate text-sm text-ink-muted">
              <template v-if="c.kind !== 'direct' && c.last_message?.sender_name">{{ c.last_message.sender_name }}: </template>{{ chatPreview(c.last_message) }}
            </span>
            <span
              v-if="c.unread > 0"
              class="shrink-0 rounded-full bg-brand-accent-strong px-1.5 py-0.5 text-xs font-semibold text-ink"
              :aria-label="`${c.unread} unread`"
            >{{ c.unread }}</span>
          </span>
        </span>
      </BaseButton>
    </li>
  </ul>
</template>
