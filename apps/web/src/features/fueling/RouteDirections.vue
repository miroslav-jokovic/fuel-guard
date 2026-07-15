<script setup lang="ts">
import { computed, ref } from "vue";
import { ChevronDownIcon } from "@heroicons/vue/20/solid";
import { ListBulletIcon } from "@heroicons/vue/24/outline";
import BaseCard from "@/components/ui/BaseCard.vue";

const props = defineProps<{ directions: { instruction: string; miles: number }[] }>();

const open = ref(true);
const hasDirections = computed(() => props.directions.length > 0);
// Cumulative mileage so each step reads like a nav app ("at 142 mi …").
const rows = computed(() => {
  let cum = 0;
  return props.directions.map((d, i) => {
    const atMile = cum;
    cum += d.miles;
    return { n: i + 1, instruction: d.instruction, miles: d.miles, atMile: Math.round(atMile) };
  });
});
</script>

<template>
  <BaseCard v-if="hasDirections" padding="none">
    <button
      type="button"
      class="flex w-full items-center justify-between px-4 py-3 text-left"
      :aria-expanded="open"
      @click="open = !open"
    >
      <span class="inline-flex items-center gap-2 text-sm font-semibold text-ink">
        <ListBulletIcon class="size-5 text-ink-subtle" aria-hidden="true" />
        Turn-by-turn directions
        <span class="text-xs font-normal text-ink-muted">({{ directions.length }} steps)</span>
      </span>
      <ChevronDownIcon class="size-5 text-ink-subtle transition-transform" :class="open ? 'rotate-180' : ''" aria-hidden="true" />
    </button>
    <ol v-if="open" class="max-h-96 divide-y divide-edge-subtle overflow-auto border-t border-edge">
      <li v-for="r in rows" :key="r.n" class="flex items-start gap-3 px-4 py-2.5">
        <span class="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-subtle text-xs font-semibold text-ink-secondary">{{ r.n }}</span>
        <div class="min-w-0 flex-1">
          <p class="text-sm text-ink">{{ r.instruction }}</p>
          <p class="text-xs text-ink-muted">{{ r.miles.toLocaleString() }} mi · at {{ r.atMile.toLocaleString() }} mi</p>
        </div>
      </li>
    </ol>
  </BaseCard>
</template>
