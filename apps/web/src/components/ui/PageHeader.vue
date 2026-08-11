<script setup lang="ts">
import { AppIcon } from "@fuelguard/ui";
import { ChevronLeftIcon } from "@fuelguard/ui/icons";
import { computed } from "vue";
import { RouterLink, useRoute } from "vue-router";

const props = withDefaults(defineProps<{ title?: string; description?: string }>(), {
  title: undefined,
  description: undefined,
});
const route = useRoute();
const resolvedTitle = computed(() => props.title ?? (route.meta.title as string) ?? "FuelGuard");
</script>

<template>
  <header class="flex flex-col gap-4 border-b border-edge-subtle pb-5 sm:flex-row sm:items-end sm:justify-between">
    <div class="min-w-0">
      <RouterLink
        v-if="route.meta.parent"
        :to="(route.meta.parent as string)"
        class="mb-2 inline-flex min-h-8 items-center gap-1 rounded-control px-1 text-sm font-medium text-link hover:text-link-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      >
        <AppIcon :icon="ChevronLeftIcon" class="size-4" aria-hidden="true" />
        Back
      </RouterLink>
      <h1 class="text-2xl font-semibold tracking-tight text-ink">{{ resolvedTitle }}</h1>
      <p v-if="description || $slots.default" class="mt-1 max-w-3xl text-sm text-ink-tertiary">
        <slot>{{ description }}</slot>
      </p>
      <div v-if="$slots.freshness" class="mt-2 text-xs text-ink-tertiary">
        <slot name="freshness" />
      </div>
    </div>
    <div v-if="$slots.actions" class="flex shrink-0 flex-wrap items-center gap-2">
      <slot name="actions" />
    </div>
  </header>
</template>
