<script setup lang="ts">
withDefaults(defineProps<{ title: string; description?: string }>(), { description: undefined });
</script>

<template>
  <header
    class="flex flex-col gap-4 border-b border-edge-subtle pb-5 sm:flex-row sm:items-end sm:justify-between"
  >
    <div class="min-w-0">
      <div v-if="$slots.back" class="mb-2"><slot name="back" /></div>
      <h1 class="text-2xl font-semibold tracking-tight text-ink">{{ title }}</h1>
      <p v-if="description || $slots.default" class="mt-1 max-w-3xl text-sm text-ink-tertiary">
        <slot>{{ description }}</slot>
      </p>
    </div>
    <div v-if="$slots.actions" class="flex shrink-0 flex-wrap items-center gap-2">
      <slot name="actions" />
    </div>
  </header>
</template>
