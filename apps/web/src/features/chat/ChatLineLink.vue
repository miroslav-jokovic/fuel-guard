<script setup lang="ts">
import type { ChatKind } from "@silvicom/shared";
import { AppAvatar, AppButton as BaseButton } from "@silvicom/ui";
import ChatBody from "./ChatBody.vue";
import { chatRowTime } from "./chatTime";

/**
 * One line from somewhere else, as a row that opens it where it lives — Saved's list (CH6c-2) and
 * search's results (CH8) draw the same row: who said it and where, when, and its words, two lines at
 * most. Where is "# Loads", a group's name, or the person a direct conversation is with (`titleOf`, the
 * rail's own title, so the two never call one conversation by two names). A direct line the other person
 * sent says only their name: "Marcus Reyes in Marcus Reyes" (seen in the CH8 browser pass) tells nobody
 * anything the name alone did not.
 */
const props = defineProps<{
  line: {
    thread_id: string;
    kind: ChatKind;
    subject: string | null;
    sender_user_id: string | null;
    sender_name: string | null;
    body: string | null;
    created_at: string;
  };
  viewerId: string;
  titleOf: (threadId: string) => string | null;
}>();
defineEmits<{ open: [] }>();

function place(): string | null {
  const l = props.line;
  if (l.kind === "channel") return `# ${l.subject?.trim() || "a channel"}`;
  const where = l.subject?.trim() || props.titleOf(l.thread_id) || (l.kind === "direct" ? "a conversation" : "a group");
  return l.kind === "direct" && where === l.sender_name ? null : where;
}
</script>

<template>
  <BaseButton type="button" size="row" block variant="ghost" class="min-w-0 flex-1 px-3 py-2.5" @click="$emit('open')">
    <span class="flex w-full min-w-0 gap-3 text-left">
      <AppAvatar :label="line.sender_name" :identity="line.sender_user_id" size="sm" />
      <span class="block min-w-0 flex-1">
        <span class="flex items-baseline justify-between gap-2">
          <span class="truncate text-sm font-medium text-ink">{{ line.sender_name ?? "Someone" }} <span v-if="place()" class="font-normal text-ink-muted">in {{ place() }}</span></span>
          <time class="shrink-0 text-2xs tabular-nums text-ink-tertiary" :datetime="line.created_at">{{ chatRowTime(line.created_at) }}</time>
        </span>
        <span class="mt-0.5 line-clamp-2 block text-sm break-words text-ink-secondary">
          <ChatBody :body="line.body ?? ''" :viewer-id="viewerId" />
        </span>
      </span>
    </span>
  </BaseButton>
</template>
