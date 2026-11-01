<script setup lang="ts">
import { computed } from "vue";
import { CHAT_FILE_TYPES, type ChatFileListItem } from "@silvicom/shared";
import { AppButton as BaseButton, BaseModal, QueryState } from "@silvicom/ui";
import ChatAttachmentFile from "./ChatAttachmentFile.vue";
import ChatAttachmentImage from "./ChatAttachmentImage.vue";
import { chatRowTime } from "./chatTime";
import { useChatFilesQuery } from "./useChatFileLink";

/**
 * Every file sent in a conversation or a channel — its posts and their replies alike (0539 `chat_files`)
 * — newest first, from the header menu (CH7). Each is drawn as it is in the log, an image as its
 * thumbnail and a document as its card, so opening or saving one works the same way in both places;
 * under it, who sent it and when. A removed line's files are not listed: the reader leaves them out,
 * as the log does.
 */
const props = defineProps<{ threadId: string | null; open: boolean; viewerId: string }>();
const emit = defineEmits<{ close: [] }>();

const files = useChatFilesQuery(computed(() => props.threadId), computed(() => props.open));
const inline = (f: ChatFileListItem) => (CHAT_FILE_TYPES as Record<string, { inline: boolean }>)[f.mime]?.inline ?? false;
const sender = (f: ChatFileListItem) => (f.uploaded_by === props.viewerId ? "you" : (f.uploaded_by_name ?? "someone"));
</script>

<template>
  <BaseModal :open="open" title="Files" description="Everything sent in this conversation, newest first." size="lg" @close="emit('close')">
    <template v-if="files.items.value.length">
      <ul class="-mx-2 divide-y divide-edge-subtle">
        <li v-for="f in files.items.value" :key="f.id" class="px-2 py-3">
          <ChatAttachmentImage v-if="inline(f)" :file="f" />
          <ChatAttachmentFile v-else :file="f" />
          <p class="mt-1 text-xs text-ink-muted">Sent by {{ sender(f) }} · {{ chatRowTime(f.created_at) }}</p>
        </li>
      </ul>
      <div v-if="files.hasNextPage.value" class="mt-2 text-center">
        <BaseButton size="sm" variant="ghost" :disabled="files.isFetchingNextPage.value" @click="files.fetchNextPage()">
          {{ files.isFetchingNextPage.value ? "Loading…" : "Show earlier" }}
        </BaseButton>
      </div>
    </template>
    <div v-else class="py-6 text-center text-sm text-ink-muted">
      <QueryState
        compact
        :loading="files.isPending.value && !files.isError.value"
        :error="files.isError.value ? files.error.value : null"
        :retrying="files.isFetching.value"
        loading-text="Loading the files…"
        error-text="Could not load the conversation's files."
        @retry="files.refetch()"
      >
        No files yet. Attach one with the paperclip, or drop it on the message box.
      </QueryState>
    </div>
    <template #footer>
      <BaseButton variant="ghost" @click="emit('close')">Close</BaseButton>
    </template>
  </BaseModal>
</template>
