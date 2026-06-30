<script setup lang="ts">
// Two bound date inputs (from / to). Use with v-model:from and v-model:to.
defineProps<{ from?: string; to?: string }>();
const emit = defineEmits<{ "update:from": [v: string | undefined]; "update:to": [v: string | undefined] }>();

const onFrom = (e: Event) => emit("update:from", (e.target as HTMLInputElement).value || undefined);
const onTo = (e: Event) => emit("update:to", (e.target as HTMLInputElement).value || undefined);

const inputCls =
  "rounded-md border-0 px-2.5 py-1.5 text-sm text-gray-900 ring-1 ring-gray-300 ring-inset focus:ring-2 focus:ring-indigo-600";
</script>

<template>
  <div class="flex items-center gap-2">
    <label class="flex items-center gap-1.5 text-sm text-gray-500">
      <span class="hidden sm:inline">From</span>
      <input type="date" :value="from ?? ''" :class="inputCls" :max="to" @change="onFrom" />
    </label>
    <span class="text-gray-300">→</span>
    <label class="flex items-center gap-1.5 text-sm text-gray-500">
      <span class="hidden sm:inline">To</span>
      <input type="date" :value="to ?? ''" :class="inputCls" :min="from" @change="onTo" />
    </label>
  </div>
</template>
