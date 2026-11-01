<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import type { ChatPinnedLine } from "@silvicom/shared";
import { AppAvatar, AppButton as BaseButton, BaseModal, QueryState } from "@silvicom/ui";
import ChatBody from "./ChatBody.vue";
import { chatRowTime } from "./chatTime";
import { useChatLineActs, useChatPinsQuery } from "./useChatLineActs";

/**
 * A conversation's or a channel's pinned lines (CH6c-2), from its header menu. Anybody in it may pin
 * and unpin (0523), so the list is everyone's, latest pin first, each saying who pinned it.
 *
 * "Show" closes the list and brings the line into view in the log, focused, so the arrows carry on from
 * it. A line older than the log's loaded pages is not in the document; it says so rather than jumping
 * nowhere. A pinned REPLY lives in its post's thread, so in a channel "Show" opens that thread
 * (`thread`) and then looks for it there.
 */
const props = defineProps<{ threadId: string | null; open: boolean; viewerId: string }>();
const emit = defineEmits<{ close: []; thread: [postId: string] }>();

const pins = useChatPinsQuery(computed(() => props.threadId), computed(() => props.open));
const acts = useChatLineActs();
const missing = ref<string | null>(null);
/** The line "Show" found; focused once the dialog has finished closing (BaseModal `closed`). */
let target: HTMLElement | null = null;

async function show(pin: ChatPinnedLine) {
  missing.value = null;
  if (pin.parent_id) emit("thread", pin.parent_id);
  await nextTick();
  const row = document.getElementById(`chat-line-${pin.id}`);
  if (!row) { missing.value = pin.id; return; }
  target = row;
  emit("close");
}
function onClosed() {
  if (!target) return;
  target.scrollIntoView({ block: "center" });
  target.focus();
  target = null;
}
</script>

<template>
  <BaseModal :open="open" title="Pinned messages" description="Anyone in the conversation can pin or unpin a message." size="lg" @close="emit('close')" @closed="onClosed">
    <ul v-if="pins.data.value?.length" class="-mx-2 divide-y divide-edge-subtle">
      <li v-for="p in pins.data.value" :key="p.id" class="flex gap-3 px-2 py-3">
        <AppAvatar :label="p.sender_name" :identity="p.sender_user_id" size="sm" />
        <div class="min-w-0 flex-1 text-sm">
          <p class="flex items-baseline gap-2">
            <span class="truncate font-semibold text-ink">{{ p.sender_name ?? "Someone" }}</span>
            <time class="shrink-0 text-xs text-ink-muted" :datetime="p.created_at">{{ chatRowTime(p.created_at) }}</time>
          </p>
          <p class="line-clamp-3 break-words whitespace-pre-wrap text-ink"><ChatBody :body="p.body ?? ''" :viewer-id="viewerId" /></p>
          <p class="mt-1 text-xs text-ink-muted">Pinned by {{ p.pinned_by === viewerId ? "you" : (p.pinned_by_name ?? "someone") }} · {{ chatRowTime(p.pinned_at) }}</p>
          <p v-if="missing === p.id" class="mt-1 text-xs text-ink-secondary" role="status">It is further up. Close this and press Show earlier to reach it.</p>
        </div>
        <div class="flex shrink-0 items-start gap-1">
          <BaseButton size="sm" variant="secondary" @click="show(p)">Show</BaseButton>
          <BaseButton v-if="acts" size="sm" variant="ghost" @click="acts.pin(p.id, false)">Unpin</BaseButton>
        </div>
      </li>
    </ul>
    <div v-else class="py-6 text-center text-sm text-ink-muted">
      <QueryState
        compact
        :loading="pins.isPending.value && !pins.isError.value"
        :error="pins.isError.value ? pins.error.value : null"
        :retrying="pins.isFetching.value"
        loading-text="Loading the pinned messages…"
        error-text="Could not load the pinned messages."
        @retry="pins.refetch()"
      >
        Nothing is pinned yet. Point at a message and press the pin to keep it here.
      </QueryState>
    </div>
    <template #footer>
      <BaseButton variant="ghost" @click="emit('close')">Close</BaseButton>
    </template>
  </BaseModal>
</template>
