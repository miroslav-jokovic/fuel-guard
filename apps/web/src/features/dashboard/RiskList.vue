<script setup lang="ts">
import { RouterLink } from "vue-router";
import { ShieldCheckIcon } from "@heroicons/vue/24/outline";
import type { RiskRow } from "@fuelguard/shared";

defineProps<{
  title: string;
  rows: RiskRow[];
  /** e.g. "/vehicles" — rows link to `${linkBase}/${id}`. Omit for non-linkable rows. */
  linkBase?: string;
  emptyLabel: string;
}>();
</script>

<template>
  <div class="flex h-full flex-col rounded-xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
    <h3 class="text-sm font-semibold text-gray-900">{{ title }}</h3>

    <div v-if="rows.length === 0" class="flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center">
      <ShieldCheckIcon class="size-8 text-emerald-500" aria-hidden="true" />
      <p class="text-sm font-medium text-gray-900">{{ emptyLabel }}</p>
      <p class="text-xs text-gray-500">No open cases in this period.</p>
    </div>

    <ul v-else class="mt-2 divide-y divide-gray-100">
      <li v-for="(row, i) in rows" :key="row.id">
        <component
          :is="linkBase ? RouterLink : 'div'"
          :to="linkBase ? `${linkBase}/${row.id}` : undefined"
          :class="[
            'group -mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5',
            linkBase &&
              'hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-indigo-600',
          ]"
        >
          <span
            class="flex size-6 shrink-0 items-center justify-center rounded-md bg-gray-100 text-xs font-semibold text-gray-500 tabular-nums"
            aria-hidden="true"
          >
            {{ i + 1 }}
          </span>
          <span
            class="min-w-0 flex-1 truncate text-sm font-medium"
            :class="linkBase ? 'text-gray-900 group-hover:text-indigo-600' : 'text-gray-900'"
          >
            {{ row.label }}
          </span>
          <span
            v-if="row.criticalCount"
            class="inline-flex items-center rounded-md bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 ring-1 ring-red-600/20 ring-inset tabular-nums"
          >
            {{ row.criticalCount }} critical
          </span>
          <span
            class="inline-flex items-center rounded-md bg-gray-50 px-2 py-0.5 text-xs font-medium text-gray-600 ring-1 ring-gray-500/10 ring-inset tabular-nums"
          >
            {{ row.anomalyCount }} open
          </span>
        </component>
      </li>
    </ul>
  </div>
</template>
