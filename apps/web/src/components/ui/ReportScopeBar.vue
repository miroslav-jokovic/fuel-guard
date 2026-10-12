<script setup lang="ts">
import { AppCard } from "@silvicom/ui";
import { countLabelFor } from "@/lib/plural";

withDefaults(
  defineProps<{
    title: string;
    description?: string;
    count?: number | null;
    countLabel?: string;
  }>(),
  {
    description: undefined,
    count: null,
    countLabel: "results",
  },
);
</script>

<template>
  <AppCard as="section" padding="sm" :aria-label="title">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p class="text-xs font-semibold tracking-wide text-ink-muted uppercase">{{ title }}</p>
        <p v-if="description" class="mt-1 text-sm text-ink-secondary">{{ description }}</p>
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <span v-if="count != null" class="whitespace-nowrap text-sm text-ink-muted">
          {{ count.toLocaleString() }} {{ countLabelFor(count, countLabel) }}
        </span>
        <slot name="control" />
      </div>
    </div>
  </AppCard>
</template>
