<script setup lang="ts">
import { computed, ref } from "vue";
import { chatLinkState } from "./transport";
import { groupLines, type MergedLine } from "./chatGrouping";
import { lineKey, useChatScroll } from "./earlierPages";
import type { PendingLine } from "./useChat";
import ChatEarlierButton from "./ChatEarlierButton.vue";
import ChatMessageRow from "./ChatMessageRow.vue";
import ChatPendingRow from "./ChatPendingRow.vue";

/**
 * The log of a conversation, a channel or a thread (CHAT-REDESIGN-PLAN D-CHATUI4, D-CHATUI6,
 * D-CHATUI11): its lines gathered into runs and days by `chatGrouping.ts`, oldest at the top; a day
 * divider above each day; a "New" line above the first line you had not read when it opened; and
 * "Show earlier" at the top while the page above exists (CH6a). The scroller keeps its place when an
 * earlier page lands and follows the bottom otherwise (`useChatScroll`).
 *
 * The scroller is a live region of the polite kind — `role="log"` with `aria-relevant="additions"`,
 * never assertive — and takes focus, so a keyboard can scroll it and a screen reader can read it as
 * one thing with the conversation's name.
 */
const props = defineProps<{
  lines: readonly MergedLine[];
  viewerId: string;
  viewerName: string;
  /** What this log is, for a screen reader: the conversation's title, "# General", "Thread". */
  label: string;
  /** Scroll anchoring restarts when this changes: the thread id, or the post id for a thread. */
  viewKey: string;
  firstUnreadSeq: number | null;
  beforeSeq: number | null;
  earlierLoading: boolean;
  earlierFailed: boolean;
  noun: string;
  emptyText: string;
  /** The seq under which a direct conversation says Seen. */
  seenSeq?: number | null;
  canReply?: boolean;
  openPostId?: string | null;
}>();
const emit = defineEmits<{
  edit: [messageId: string, body: string];
  remove: [messageId: string];
  reply: [messageId: string];
  retry: [line: PendingLine];
  earlier: [];
}>();

const days = computed(() => groupLines(props.lines, props.viewerId, props.firstUnreadSeq));

const scroller = ref<HTMLElement | null>(null);
useChatScroll(scroller, () => [props.viewKey, props.lines[0] && lineKey(props.lines[0]), props.lines.at(-1) && lineKey(props.lines.at(-1)!)]);
defineExpose({ scroller });
</script>

<template>
  <div
    ref="scroller"
    class="min-h-0 flex-1 overflow-y-auto px-2 pb-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring sm:px-4"
    role="log"
    aria-live="polite"
    aria-relevant="additions"
    :aria-label="label"
    tabindex="0"
  >
    <!-- Only once a live link has dropped (or never came up): the polls carry on meanwhile at their fast
         pace, so nothing is lost — it is only slower (CH3b). The stage's strip, since there is no page
         header to put it in (D-CHATUI10). -->
    <p v-if="chatLinkState === 'reconnecting'" role="status" class="sticky top-0 z-sticky -mx-2 bg-surface-muted px-4 py-1 text-center text-xs text-ink-muted sm:-mx-4">
      Reconnecting… messages may take a few seconds.
    </p>

    <div class="max-w-3xl">
      <div v-if="beforeSeq" class="pt-3">
        <ChatEarlierButton :noun="noun" :loading="earlierLoading" :failed="earlierFailed" @load="emit('earlier')" />
      </div>
      <p v-if="lines.length === 0" class="py-10 text-center text-sm text-ink-muted">{{ emptyText }}</p>

      <template v-for="day in days" :key="day.key">
        <div class="flex items-center gap-3 pt-4" role="separator" :aria-label="day.label">
          <span class="h-px flex-1 bg-edge-subtle" aria-hidden="true" />
          <span class="text-xs font-medium text-ink-muted">{{ day.label }}</span>
          <span class="h-px flex-1 bg-edge-subtle" aria-hidden="true" />
        </div>

        <template v-for="row in day.rows" :key="row.key">
          <div v-if="row.unreadStart" class="flex items-center gap-3 pt-3" role="separator" aria-label="New messages">
            <span class="h-px flex-1 bg-brand-accent-strong" aria-hidden="true" />
            <span class="text-xs font-semibold text-brand-accent-strong">New</span>
          </div>
          <ChatMessageRow
            v-if="row.line.kind === 'server'"
            :message="row.line.message"
            :viewer-id="viewerId"
            :first="row.first"
            :can-reply="canReply"
            :open="openPostId === row.line.message.id"
            @edit="(id: string, body: string) => emit('edit', id, body)"
            @remove="(id: string) => emit('remove', id)"
            @reply="(id: string) => emit('reply', id)"
          >
            <template #stamp>
              <span v-if="seenSeq !== null && seenSeq !== undefined && row.line.message.seq === seenSeq" class="ml-1 text-xs text-ink-muted">· Seen</span>
            </template>
          </ChatMessageRow>
          <ChatPendingRow v-else :line="row.line.line" :first="row.first" :viewer-name="viewerName" @retry="(line: PendingLine) => emit('retry', line)" />
        </template>
      </template>
    </div>
  </div>
</template>
