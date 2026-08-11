<script setup lang="ts">
import type { Icon } from "../icons";
import AppIcon from "./AppIcon.vue";

withDefaults(
  defineProps<{
    icon: Icon;
    label: string;
    variant?: "secondary" | "ghost" | "danger";
    size?: "sm" | "md";
    type?: "button" | "submit" | "reset";
    disabled?: boolean;
  }>(),
  { variant: "ghost", size: "md", type: "button", disabled: false },
);
</script>

<template>
  <button
    :type="type"
    :disabled="disabled"
    :aria-label="label"
    class="inline-flex shrink-0 items-center justify-center rounded-control transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:pointer-events-none disabled:opacity-60"
    :class="[
      size === 'sm' ? 'size-8' : 'size-9',
      variant === 'secondary' &&
        'bg-surface text-ink-secondary ring-1 ring-inset ring-edge-control hover:bg-surface-subtle',
      variant === 'ghost' && 'text-ink-tertiary hover:bg-surface-muted hover:text-ink',
      variant === 'danger' && 'text-danger-700 hover:bg-danger-subtle',
    ]"
  >
    <AppIcon :icon="icon" :class="size === 'sm' ? 'size-4' : 'size-5'" aria-hidden="true" />
  </button>
</template>
