<script setup lang="ts">
import { computed } from "vue";
import type { ChatAttachment } from "@silvicom/shared";
import { AppButton as BaseButton } from "@silvicom/ui";
import { useChatFileLink } from "./useChatFileLink";

/**
 * One image a line carries, as a thumbnail (CH7). Its URL is the five-minute link, fetched when the
 * thumbnail is drawn; pressing it opens the full image in a new tab. While the link is on its way the
 * frame keeps the thumbnail's size, so the log does not jump when it lands.
 */
const props = defineProps<{ file: ChatAttachment }>();
const link = useChatFileLink(computed(() => props.file.id), computed(() => true));
function open() {
  if (link.data.value) window.open(link.data.value.url, "_blank", "noopener");
}
</script>

<template>
  <BaseButton
    variant="ghost"
    size="media"
    class="ring-1 ring-edge-subtle"
    :aria-label="`Open ${file.file_name}`"
    :title="file.file_name"
    :disabled="!link.data.value"
    @click="open"
  >
    <img
      v-if="link.data.value"
      :src="link.data.value.url"
      :alt="file.file_name"
      class="block h-40 max-w-64 object-cover"
      loading="lazy"
    />
    <span v-else class="block h-40 w-40 animate-pulse bg-surface-muted" aria-hidden="true" />
  </BaseButton>
</template>
