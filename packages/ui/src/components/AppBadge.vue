<script setup lang="ts">
withDefaults(
  defineProps<{
    tone?: "danger" | "caution" | "warning" | "success" | "info" | "brand" | "neutral";
  }>(),
  { tone: "neutral" },
);

const tones = {
  danger: "bg-danger-50 text-danger-700 ring-danger-600/20",
  caution: "bg-caution-50 text-caution-700 ring-caution-600/20",
  warning: "bg-warning-50 text-warning-700 ring-warning-600/20",
  success: "bg-success-50 text-success-700 ring-success-600/20",
  info: "bg-info-50 text-info-700 ring-info-600/20",
  brand: "bg-brand-50 text-brand-700 ring-brand-600/20",
  neutral: "bg-surface-subtle text-ink-muted ring-neutral-500/20",
} as const;
</script>

<template>
  <span
    class="inline-flex items-center gap-1 rounded-detail px-2 py-0.5 text-xs font-medium capitalize ring-1 ring-inset"
    :class="tones[tone]"
  >
    <slot />
  </span>
</template>
