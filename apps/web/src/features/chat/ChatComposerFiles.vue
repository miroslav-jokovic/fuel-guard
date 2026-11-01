<script setup lang="ts">
import { chatFileSize, CHAT_FILE_TYPES } from "@silvicom/shared";
import { AppButton as BaseButton, AppIcon, AppIconButton } from "@silvicom/ui";
import { DocumentTextIcon, XMarkIcon } from "@silvicom/ui/icons";
import type { PendingFile } from "./useChatAttachments";

/**
 * The files waiting in a composer, above its toolbar (CH7): a thumbnail for an image from the person's own
 * copy, a document's kind and size for the rest, and each one's state — uploading, ready, or failed with
 * Retry. Each can be removed. A refusal (a kind we do not take, too large, an eleventh) says why, once.
 */
defineProps<{ files: readonly PendingFile[]; refusal: string | null }>();
defineEmits<{ remove: [key: string]; retry: [key: string] }>();
</script>

<template>
  <div v-if="files.length || refusal" class="px-2 pt-1">
    <ul v-if="files.length" class="flex flex-wrap gap-2" aria-label="Files to send">
      <li
        v-for="f in files"
        :key="f.key"
        class="flex max-w-60 items-center gap-2 rounded-control bg-surface-subtle py-1 pr-1 pl-1 ring-1 ring-inset"
        :class="f.state === 'failed' ? 'ring-danger-600' : 'ring-edge-subtle'"
      >
        <img v-if="f.preview" :src="f.preview" alt="" class="size-10 shrink-0 rounded-detail object-cover" />
        <span v-else class="flex size-10 shrink-0 items-center justify-center rounded-detail bg-surface text-ink-tertiary" aria-hidden="true">
          <AppIcon :icon="DocumentTextIcon" class="size-5" />
        </span>
        <span class="min-w-0 flex-1">
          <span class="block truncate text-xs font-medium text-ink" :title="f.name">{{ f.name }}</span>
          <span class="block text-2xs text-ink-muted" aria-live="polite">
            <template v-if="f.state === 'uploading'">Uploading…</template>
            <template v-else-if="f.state === 'failed'"><span class="text-danger-text">{{ f.error }}</span></template>
            <template v-else>{{ CHAT_FILE_TYPES[f.mime].label }} · {{ chatFileSize(f.size) }}</template>
          </span>
        </span>
        <BaseButton v-if="f.state === 'failed'" size="sm" variant="link" class="text-xs" @click="$emit('retry', f.key)">Retry</BaseButton>
        <AppIconButton :icon="XMarkIcon" :label="`Remove ${f.name}`" size="sm" @click="$emit('remove', f.key)" />
      </li>
    </ul>
    <p v-if="refusal" class="mt-1 text-xs text-danger-text" role="alert">{{ refusal }}</p>
  </div>
</template>
