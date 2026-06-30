<script setup lang="ts">
import { ExclamationTriangleIcon, ArrowPathIcon } from "@heroicons/vue/20/solid";

withDefaults(defineProps<{ message?: string; retrying?: boolean }>(), {
  message: "Something went wrong while loading this data.",
});
const emit = defineEmits<{ retry: [] }>();
</script>

<template>
  <div class="flex flex-col items-center gap-3 px-6 py-12 text-center">
    <ExclamationTriangleIcon class="size-8 text-amber-500" aria-hidden="true" />
    <p class="max-w-md text-sm text-gray-600">{{ message }}</p>
    <button
      type="button"
      :disabled="retrying"
      class="inline-flex items-center gap-x-1.5 rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-700 ring-1 ring-gray-300 ring-inset hover:bg-gray-50 disabled:opacity-50"
      @click="emit('retry')"
    >
      <ArrowPathIcon class="size-4" :class="{ 'animate-spin': retrying }" aria-hidden="true" />
      {{ retrying ? "Retrying…" : "Retry" }}
    </button>
  </div>
</template>
