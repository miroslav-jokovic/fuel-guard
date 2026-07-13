<script setup lang="ts">
import { RouterLink } from "vue-router";
import { ShieldCheckIcon } from "@heroicons/vue/24/outline";
import type { RiskRow } from "@fuelguard/shared";
import BaseCard from "@/components/ui/BaseCard.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";

defineProps<{
  title: string;
  rows: RiskRow[];
  /** e.g. "/vehicles" — rows link to `${linkBase}/${id}`. Omit for non-linkable rows. */
  linkBase?: string;
  emptyLabel: string;
}>();
</script>

<template>
  <BaseCard class="flex h-full flex-col">
    <h3 class="text-sm font-semibold text-ink">{{ title }}</h3>

    <div v-if="rows.length === 0" class="flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center">
      <ShieldCheckIcon class="size-8 text-success-500" aria-hidden="true" />
      <p class="text-sm font-medium text-ink">{{ emptyLabel }}</p>
      <p class="text-xs text-ink-muted">No open cases in this period.</p>
    </div>

    <ul v-else class="mt-2 divide-y divide-edge-subtle">
      <li v-for="(row, i) in rows" :key="row.id">
        <component
          :is="linkBase ? RouterLink : 'div'"
          :to="linkBase ? `${linkBase}/${row.id}` : undefined"
          :class="[
            'group -mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5',
            linkBase &&
              'hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-brand-600',
          ]"
        >
          <span
            class="flex size-6 shrink-0 items-center justify-center rounded-md bg-surface-muted text-xs font-semibold text-ink-muted tabular-nums"
            aria-hidden="true"
          >
            {{ i + 1 }}
          </span>
          <span
            class="min-w-0 flex-1 truncate text-sm font-medium"
            :class="linkBase ? 'text-ink group-hover:text-brand-600' : 'text-ink'"
          >
            {{ row.label }}
          </span>
          <span v-if="row.criticalCount" :class="[BADGE_BASE, toneClass('danger'), 'normal-case tabular-nums']">
            {{ row.criticalCount }} critical
          </span>
          <span :class="[BADGE_BASE, toneClass('neutral'), 'normal-case tabular-nums']">
            {{ row.anomalyCount }} open
          </span>
        </component>
      </li>
    </ul>
  </BaseCard>
</template>
