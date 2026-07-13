<script setup lang="ts">
import BaseCard from "@/components/ui/BaseCard.vue";

defineProps<{
  title: string;
  subtitle?: string;
}>();
</script>

<template>
  <BaseCard>
    <div class="mb-4 flex items-baseline justify-between gap-2">
      <div>
        <h3 class="text-sm font-semibold text-ink">{{ title }}</h3>
        <p v-if="subtitle" class="mt-0.5 text-xs text-ink-muted">{{ subtitle }}</p>
      </div>
      <slot name="meta" />
    </div>
    <slot />
  </BaseCard>
</template>
