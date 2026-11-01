<script setup lang="ts">
import { computed, ref } from "vue";
import { useQueryClient } from "@tanstack/vue-query";
import { CHAT_FILE_TYPES, chatFileSize, type ChatAttachment } from "@silvicom/shared";
import { AppIcon, AppIconButton } from "@silvicom/ui";
import { ArrowDownTrayIcon, DocumentTextIcon } from "@silvicom/ui/icons";
import { fetchChatFileLink, fileLinkKey, followDownload } from "./useChatFileLink";

/**
 * One document a line carries, as a card (CH7): its kind, its name and its size, and Download. The link
 * is asked for only when Download is pressed — a log of fifty PDFs asks for none of them — and the API
 * signs a document as a DOWNLOAD under its own name (D-CHAT30), so following the link saves the file
 * and never draws it on our page (`followDownload`).
 *
 * A link that cannot be had says so on the card, in words, and the button stays to try again.
 */
const props = defineProps<{ file: ChatAttachment }>();
const qc = useQueryClient();
const busy = ref(false);
const failed = ref(false);
const kind = computed(() => (CHAT_FILE_TYPES as Record<string, { label: string }>)[props.file.mime]?.label ?? "File");

async function download() {
  busy.value = true;
  failed.value = false;
  try {
    const link = await qc.fetchQuery({ queryKey: fileLinkKey(props.file.id), queryFn: () => fetchChatFileLink(props.file.id), staleTime: 4 * 60_000 });
    followDownload(link.url);
  } catch {
    failed.value = true;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="flex w-72 max-w-full items-center gap-3 rounded-control bg-surface py-2 pr-1 pl-2 ring-1 ring-inset ring-edge-subtle" data-chat-file>
    <span class="flex size-9 shrink-0 items-center justify-center rounded-detail bg-surface-subtle text-ink-tertiary" aria-hidden="true">
      <AppIcon :icon="DocumentTextIcon" class="size-5" />
    </span>
    <span class="min-w-0 flex-1">
      <span class="block truncate text-sm font-medium text-ink" :title="file.file_name">{{ file.file_name }}</span>
      <span v-if="failed" class="block text-xs text-danger-text" role="alert">Could not get the download link. Try again.</span>
      <span v-else class="block text-xs text-ink-muted">{{ kind }} · {{ chatFileSize(file.byte_size) }}</span>
    </span>
    <AppIconButton :icon="ArrowDownTrayIcon" :label="`Download ${file.file_name}`" size="sm" :disabled="busy" @click="download" />
  </div>
</template>
