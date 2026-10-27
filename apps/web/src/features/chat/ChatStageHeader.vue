<script setup lang="ts">
import { AppAvatar, AppIcon, AppIconButton } from "@silvicom/ui";
import { BellIcon, ChevronLeftIcon, UserGroupIcon } from "@silvicom/ui/icons";

/**
 * The strip above a log (CHAT-REDESIGN-PLAN §4): who or what this is, in the same glyph the rail
 * showed — a person's initials, `#` for a channel, the group mark — the name, a line about who is in it,
 * and the acts at the right (the caller's slot: a kebab, Close). Below `lg` a phone shows the rail OR
 * the stage, and the chevron at the left is the way back.
 */
defineProps<{
  title: string;
  subtitle?: string | null;
  glyph: "person" | "group" | "channel" | "activity";
  /** Why the back chevron is there: "Back to conversations", "Back to the channel". */
  backLabel?: string;
  /** The width from which the thing behind is beside this rather than replaced by it: `lg` for the rail, `xl` for a channel behind its thread. */
  backUntil?: "lg" | "xl";
}>();
defineEmits<{ back: [] }>();
</script>

<template>
  <header class="flex h-14 shrink-0 items-center gap-2 border-b border-edge-subtle px-2 sm:px-4">
    <AppIconButton v-if="backLabel" :icon="ChevronLeftIcon" :label="backLabel" :class="backUntil === 'xl' ? 'xl:hidden' : 'lg:hidden'" @click="$emit('back')" />
    <AppAvatar v-if="glyph === 'person'" :label="title" size="sm" />
    <span
      v-else
      class="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-muted text-sm font-semibold text-ink-secondary ring-1 ring-inset ring-edge"
      aria-hidden="true"
    >
      <AppIcon v-if="glyph === 'group'" :icon="UserGroupIcon" class="size-4" />
      <AppIcon v-else-if="glyph === 'activity'" :icon="BellIcon" class="size-4" />
      <template v-else>#</template>
    </span>
    <div class="min-w-0 flex-1">
      <h2 class="truncate text-sm font-semibold text-ink">{{ title }}</h2>
      <p v-if="subtitle" class="truncate text-xs text-ink-muted">{{ subtitle }}</p>
    </div>
    <div class="flex shrink-0 items-center gap-1"><slot /></div>
  </header>
</template>
