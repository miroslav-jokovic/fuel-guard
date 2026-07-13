<script setup lang="ts">
defineProps<{
  title: string;
  subtitle?: string;
}>();
</script>

<template>
  <div class="rounded-xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
    <div class="mb-4 flex items-baseline justify-between gap-2">
      <div>
        <h3 class="text-sm font-semibold text-gray-900">{{ title }}</h3>
        <p v-if="subtitle" class="mt-0.5 text-xs text-gray-500">{{ subtitle }}</p>
      </div>
      <slot name="meta" />
    </div>
    <slot />
  </div>
</template>
