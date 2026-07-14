<script setup lang="ts">
import { ref } from "vue";
import { FunnelIcon, XMarkIcon } from "@heroicons/vue/20/solid";
import { useFloating, offset, flip, shift, autoUpdate } from "@floating-ui/vue";
import SearchInput from "@/components/SearchInput.vue";
import BaseCard from "./BaseCard.vue";
import BaseButton from "./BaseButton.vue";

/**
 * The standard table toolbar (see docs/DESIGN-SYSTEM.md §3). One card:
 *
 *   [ search ] [ primary filter controls … ] [⏷ Filters] ······ count · actions
 *   [ chip: Unit 204 ✕ ] [ chip: Dates Jul 1 – 13 ✕ ]  Clear all      ← when active
 *
 * - #filters — the 2–4 PRIMARY dimensions (AppSelect / DateRangeFilter /
 *   VehicleSelect), live-applied.
 * - #more — secondary filters, shown in the "Filters" popover (only render
 *   the button when the slot is provided). `moreCount` badges active ones.
 * - chips — every active filter as a removable token; emits `remove(key)`
 *   per chip and `clear-all` for the trailing ghost button.
 * - count — always-visible result feedback ("1,204 transactions").
 * - #actions — page-level buttons that belong to the table (Export, Rescore…).
 */
export interface FilterChip {
  key: string;
  label: string;
  value: string;
}

withDefaults(
  defineProps<{
    search?: string;
    searchPlaceholder?: string;
    count?: number | null;
    countLabel?: string;
    chips?: FilterChip[];
    moreCount?: number;
  }>(),
  {
    search: undefined,
    searchPlaceholder: "Search…",
    count: null,
    countLabel: "results",
    chips: () => [],
    moreCount: 0,
  },
);
const emit = defineEmits<{
  "update:search": [value: string];
  remove: [key: string];
  "clear-all": [];
}>();

/* "Filters" popover (same floating recipe as KebabMenu) */
const moreOpen = ref(false);
const triggerRef = ref<HTMLElement | null>(null);
const panelRef = ref<HTMLElement | null>(null);
const { floatingStyles } = useFloating(triggerRef, panelRef, {
  placement: "bottom-end",
  middleware: [offset(4), flip(), shift({ padding: 8 })],
  whileElementsMounted: autoUpdate,
});
</script>

<template>
  <BaseCard padding="sm">
    <div class="flex flex-col gap-3 lg:flex-row lg:items-center">
      <div v-if="search !== undefined" class="w-full lg:w-72 lg:shrink-0">
        <SearchInput
          :model-value="search"
          :placeholder="searchPlaceholder"
          @update:model-value="emit('update:search', $event)"
        />
      </div>

      <div v-if="$slots.filters" class="flex flex-wrap items-center gap-2">
        <slot name="filters" />
      </div>

      <div v-if="$slots.more">
        <button
          ref="triggerRef"
          type="button"
          class="inline-flex items-center gap-x-1.5 rounded-md bg-surface px-2.5 py-1.5 text-sm font-medium text-ink-secondary ring-1 ring-inset ring-edge-strong hover:bg-surface-subtle"
          :aria-expanded="moreOpen"
          aria-haspopup="dialog"
          @click.stop="moreOpen = !moreOpen"
          @keydown.escape="moreOpen = false"
        >
          <FunnelIcon class="size-4 text-ink-subtle" aria-hidden="true" />
          Filters
          <span
            v-if="moreCount"
            class="rounded-full bg-brand-50 px-1.5 text-xs font-semibold text-brand-700 ring-1 ring-inset ring-brand-600/20"
            >{{ moreCount }}</span
          >
        </button>
        <Teleport to="body">
          <template v-if="moreOpen">
            <div class="fixed inset-0 z-[9998]" @click.stop="moreOpen = false" />
            <div
              ref="panelRef"
              :style="floatingStyles"
              class="z-[9999] w-72 rounded-md bg-surface p-4 text-sm shadow-lg ring-1 ring-edge"
              role="dialog"
              aria-label="More filters"
            >
              <div class="space-y-3">
                <slot name="more" />
              </div>
            </div>
          </template>
        </Teleport>
      </div>

      <div class="flex items-center gap-3 lg:ml-auto lg:shrink-0">
        <span v-if="count != null" class="whitespace-nowrap text-sm text-ink-muted">
          {{ count.toLocaleString() }} {{ countLabel }}
        </span>
        <slot name="actions" />
      </div>
    </div>

    <!-- Applied filters -->
    <div v-if="chips.length" class="mt-3 flex flex-wrap items-center gap-2 border-t border-edge-subtle pt-3">
      <button
        v-for="c in chips"
        :key="c.key"
        type="button"
        class="group inline-flex items-center gap-1 rounded-md bg-surface-muted py-0.5 pr-1 pl-2 text-xs font-medium text-ink-secondary ring-1 ring-inset ring-edge hover:bg-neutral-200"
        :aria-label="`Remove filter ${c.label}: ${c.value}`"
        @click="emit('remove', c.key)"
      >
        <span class="text-ink-muted">{{ c.label }}:</span>
        {{ c.value }}
        <XMarkIcon class="size-3.5 text-ink-subtle group-hover:text-ink-secondary" aria-hidden="true" />
      </button>
      <BaseButton variant="ghost" size="sm" @click="emit('clear-all')">Clear all</BaseButton>
    </div>
  </BaseCard>
</template>
