<script setup lang="ts">
import { computed } from "vue";
import { CHAT_FILE_TYPES, type ChatAttachment } from "@silvicom/shared";
import ChatAttachmentFile from "./ChatAttachmentFile.vue";
import ChatAttachmentImage from "./ChatAttachmentImage.vue";

/**
 * A line's files, under its words (CH7): the images first, as thumbnails in a row that wraps, then each
 * document as a card. Which is which is the contract's `inline` (D-CHAT30) — the same fact the API reads
 * to sign an image to draw and a document to save — so the two can never disagree about a kind.
 */
const props = defineProps<{ files: readonly ChatAttachment[] }>();
const inline = (f: ChatAttachment) => (CHAT_FILE_TYPES as Record<string, { inline: boolean }>)[f.mime]?.inline ?? false;
const images = computed(() => props.files.filter(inline));
const documents = computed(() => props.files.filter((f) => !inline(f)));
</script>

<template>
  <div v-if="files.length" class="mt-1.5 flex flex-col gap-2" data-chat-attachments>
    <ul v-if="images.length" class="flex flex-wrap gap-2" aria-label="Images">
      <li v-for="f in images" :key="f.id"><ChatAttachmentImage :file="f" /></li>
    </ul>
    <ul v-if="documents.length" class="flex flex-col gap-2" aria-label="Files">
      <li v-for="f in documents" :key="f.id"><ChatAttachmentFile :file="f" /></li>
    </ul>
  </div>
</template>
