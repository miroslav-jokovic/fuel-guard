<script setup lang="ts">
// From/To date range with quick presets. Use with v-model:from and v-model:to (values are YYYY-MM-DD).
withDefaults(defineProps<{ from?: string; to?: string; presets?: boolean }>(), {
  from: undefined,
  to: undefined,
  presets: true,
});
const emit = defineEmits<{ "update:from": [v: string | undefined]; "update:to": [v: string | undefined] }>();

const onFrom = (e: Event) => emit("update:from", (e.target as HTMLInputElement).value || undefined);
const onTo = (e: Event) => emit("update:to", (e.target as HTMLInputElement).value || undefined);

const iso = (d: Date) => d.toISOString().slice(0, 10);
function preset(days: number) {
  const end = new Date();
  const start = new Date(end.getTime() - days * 86400_000);
  emit("update:from", iso(start));
  emit("update:to", iso(end));
}
function clear() {
  emit("update:from", undefined);
  emit("update:to", undefined);
}

const inputCls =
  "w-full rounded-md border-0 px-2.5 py-1.5 text-sm text-gray-900 ring-1 ring-gray-300 ring-inset focus:ring-2 focus:ring-indigo-600 sm:w-auto";
const chipCls =
  "rounded-md px-2.5 py-1 text-xs font-medium text-gray-600 ring-1 ring-gray-200 ring-inset hover:bg-gray-50";
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <div class="flex flex-1 items-center gap-2 sm:flex-initial">
      <input type="date" :value="from ?? ''" :class="inputCls" :max="to" aria-label="From date" @change="onFrom" />
      <span class="text-gray-300">→</span>
      <input type="date" :value="to ?? ''" :class="inputCls" :min="from" aria-label="To date" @change="onTo" />
    </div>
    <div v-if="presets" class="flex flex-wrap items-center gap-1.5">
      <button type="button" :class="chipCls" @click="preset(7)">7d</button>
      <button type="button" :class="chipCls" @click="preset(30)">30d</button>
      <button type="button" :class="chipCls" @click="preset(90)">90d</button>
      <button v-if="from || to" type="button" :class="chipCls" @click="clear">Clear</button>
    </div>
  </div>
</template>
