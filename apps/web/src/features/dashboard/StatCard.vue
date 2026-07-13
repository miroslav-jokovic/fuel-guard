<script setup lang="ts">
import type { FunctionalComponent } from "vue";
import BaseCard from "@/components/ui/BaseCard.vue";
import SparkLine from "@/components/SparkLine.vue";
import { viz } from "./chartTheme";

defineProps<{
  label: string;
  /** Display value (already formatted). */
  value: string;
  /** Exact/long-form value for the hover title when `value` is compacted. */
  valueTitle?: string;
  sub?: string;
  icon: FunctionalComponent;
  /** Tailwind classes for the icon chip, e.g. "text-success-600 bg-success-50". */
  tone: string;
  /** Optional 30-point trend; nulls render as gaps. */
  spark?: (number | null)[];
  sparkColor?: string;
  loading?: boolean;
}>();
</script>

<template>
  <BaseCard>
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <p class="truncate text-sm font-medium text-ink-muted">{{ label }}</p>
        <template v-if="loading">
          <div class="mt-2.5 h-8 w-24 animate-pulse rounded-md bg-surface-muted" />
          <div class="mt-2 h-3 w-16 animate-pulse rounded bg-surface-muted" />
        </template>
        <template v-else>
          <p class="mt-1.5 text-3xl font-semibold tracking-tight text-ink" :title="valueTitle">
            {{ value }}
          </p>
          <p v-if="sub" class="mt-1 text-xs text-ink-subtle">{{ sub }}</p>
        </template>
      </div>
      <span
        :class="['inline-flex size-9 shrink-0 items-center justify-center rounded-lg', tone]"
        aria-hidden="true"
      >
        <component :is="icon" class="size-5" />
      </span>
    </div>
    <div v-if="spark && !loading" class="mt-3">
      <SparkLine :points="spark" :color="sparkColor ?? viz.brand" />
    </div>
  </BaseCard>
</template>
