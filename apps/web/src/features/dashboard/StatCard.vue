<script setup lang="ts">
import { AppIcon } from "@fuelguard/ui";
import { type Icon } from "@fuelguard/ui/icons";
import { RouterLink } from "vue-router";
import { AppCard as BaseCard } from "@fuelguard/ui";
import SparkLine from "@/components/SparkLine.vue";
import { viz } from "./chartTheme";

defineProps<{
  label: string;
  /** Display value (already formatted). */
  value: string;
  /** Exact/long-form value for the hover title when `value` is compacted. */
  valueTitle?: string;
  sub?: string;
  icon: Icon;
  /** Tailwind classes for the icon chip, e.g. "text-success-600 bg-success-50". */
  tone: string;
  /** Optional 30-point trend; nulls render as gaps. */
  spark?: (number | null)[];
  sparkColor?: string;
  loading?: boolean;
  /** When set, the whole tile is a link to this route — an interactive drill-down into the detail page. */
  to?: string;
}>();
</script>

<template>
  <component
    :is="to ? RouterLink : 'div'"
    v-bind="to ? { to } : {}"
    :class="[
      'block rounded-dialog focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
      to ? 'group cursor-pointer' : '',
    ]"
  >
    <BaseCard
      :class="[
        'h-full',
        to ? 'transition-colors duration-150 group-hover:bg-surface-subtle group-hover:ring-edge-control' : '',
      ]"
    >
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="truncate text-sm font-medium text-ink-muted">{{ label }}</p>
          <template v-if="loading">
            <div class="mt-2.5 h-8 w-24 animate-pulse rounded-control bg-surface-muted" />
            <div class="mt-2 h-3 w-16 animate-pulse rounded-control bg-surface-muted" />
          </template>
          <template v-else>
            <p class="mt-1.5 text-3xl font-semibold tracking-tight text-ink" :title="valueTitle">
              {{ value }}
            </p>
            <p v-if="sub" class="mt-1 flex items-center gap-1 text-xs text-ink-tertiary">
              {{ sub }}
              <span v-if="to" class="text-brand-500 opacity-0 transition group-hover:opacity-100">&rarr;</span>
            </p>
          </template>
        </div>
        <span
          :class="['inline-flex size-9 shrink-0 items-center justify-center rounded-surface', tone]"
          aria-hidden="true"
        >
          <AppIcon :icon="icon" class="size-5" />
        </span>
      </div>
      <div v-if="spark && !loading" class="mt-3">
        <SparkLine :points="spark" :color="sparkColor ?? viz.brand" />
      </div>
    </BaseCard>
  </component>
</template>
