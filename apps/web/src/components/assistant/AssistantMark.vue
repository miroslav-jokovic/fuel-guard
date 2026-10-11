<script setup lang="ts">
import { AppIcon } from "@silvicom/ui";
import { SparklesIcon } from "@silvicom/ui/icons";

/**
 * The assistant's mark: the sparkle on a brand gradient tile. One component so the launcher, the
 * dock's header, the empty state and every answer wear the same identity, and a restyle is one edit.
 */
withDefaults(defineProps<{ size?: "sm" | "md" | "lg" }>(), { size: "md" });
</script>

<template>
  <span
    aria-hidden="true"
    :class="[
      'inline-flex shrink-0 items-center justify-center bg-linear-to-br from-brand-400 to-brand-700 text-ink-inverse shadow-chip-brand',
      size === 'sm' && 'size-6 rounded-detail',
      size === 'md' && 'size-7 rounded-control',
      size === 'lg' && 'size-10 rounded-surface',
    ]"
  >
    <AppIcon :icon="SparklesIcon" :class="size === 'lg' ? 'size-5' : size === 'md' ? 'size-4' : 'size-3.5'" />
  </span>
</template>
