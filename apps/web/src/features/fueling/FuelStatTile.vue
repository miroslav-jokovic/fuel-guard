<script setup lang="ts">
import BaseCard from "@/components/ui/BaseCard.vue";
withDefaults(defineProps<{ label: string; value: string; hint?: string; tone?: "ink" | "success" | "danger" | "warning" | "brand" }>(), {
  hint: undefined,
  tone: "ink",
});
const TONE: Record<string, string> = {
  ink: "text-ink",
  success: "text-success-700",
  danger: "text-danger-700",
  warning: "text-warning-700",
  brand: "text-brand-700",
};
</script>

<template>
  <BaseCard padding="sm">
    <p class="text-xs font-medium uppercase tracking-wide text-ink-muted">{{ label }}</p>
    <p class="mt-1 text-2xl font-semibold tabular-nums" :class="TONE[tone]">{{ value }}</p>
    <p v-if="hint" class="mt-0.5 text-xs text-ink-subtle">{{ hint }}</p>
  </BaseCard>
</template>
