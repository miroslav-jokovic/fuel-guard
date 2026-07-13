<script setup lang="ts">
import type { FunctionalComponent } from "vue";
import SparkLine from "@/components/SparkLine.vue";

defineProps<{
  label: string;
  /** Display value (already formatted). */
  value: string;
  /** Exact/long-form value for the hover title when `value` is compacted. */
  valueTitle?: string;
  sub?: string;
  icon: FunctionalComponent;
  /** Tailwind classes for the icon chip, e.g. "text-emerald-600 bg-emerald-50". */
  tone: string;
  /** Optional 30-point trend; nulls render as gaps. */
  spark?: (number | null)[];
  sparkColor?: string;
  loading?: boolean;
}>();
</script>

<template>
  <div class="rounded-xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <p class="truncate text-sm font-medium text-gray-500">{{ label }}</p>
        <template v-if="loading">
          <div class="mt-2.5 h-8 w-24 animate-pulse rounded-md bg-gray-100" />
          <div class="mt-2 h-3 w-16 animate-pulse rounded bg-gray-100" />
        </template>
        <template v-else>
          <p class="mt-1.5 text-3xl font-semibold tracking-tight text-gray-900" :title="valueTitle">
            {{ value }}
          </p>
          <p v-if="sub" class="mt-1 text-xs text-gray-400">{{ sub }}</p>
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
      <SparkLine :points="spark" :color="sparkColor ?? '#4f46e5'" />
    </div>
  </div>
</template>
