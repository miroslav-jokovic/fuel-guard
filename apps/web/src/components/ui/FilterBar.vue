<script setup lang="ts">
import { AppIcon } from "@silvicom/ui";
import {
  FunnelIcon,
  XMarkIcon,
} from "@silvicom/ui/icons";
import { ref } from "vue";
import { useFloating, offset, flip, shift, autoUpdate } from "@floating-ui/vue";
import { AppSearchField as SearchInput } from "@silvicom/ui";
import { AppCard as BaseCard } from "@silvicom/ui";
import { AppButton as BaseButton } from "@silvicom/ui";

/**
 * The standard table toolbar (see docs/DESIGN-SYSTEM-CONTRACT.md). One card:
 *
 *   [ search ] [ primary filter controls … ] [⏷ Filters] ······ count · actions
 *   [ chip: Unit 204 ✕ ] [ chip: Dates Jul 1 – 13 ✕ ]  Clear all      ← when active
 *
 * - #filters — the 2–4 PRIMARY dimensions as compact FilterSelect /
 *   DateRangeFilter triggers, live-applied (each shows its active value).
 * - #more — secondary filters, shown in the "Filters" popover (only render
 *   the button when the slot is provided). `moreCount` badges active ones.
 * - chips — removable tokens for the SECONDARY (popover) filters only; the
 *   inline triggers already show their values. Emits `remove(key)` /
 *   `clear-all`.
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
    embedded?: boolean;
  }>(),
  {
    search: undefined,
    searchPlaceholder: "Search…",
    count: null,
    countLabel: "results",
    chips: () => [],
    moreCount: 0,
    embedded: false,
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
  <component :is="embedded ? 'div' : BaseCard" :padding="embedded ? undefined : 'sm'" :class="embedded ? 'p-4' : ''">
    <div class="flex flex-col gap-3 lg:flex-row lg:items-center">
      <div v-if="search !== undefined" class="w-full lg:w-64 lg:shrink-0">
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
          class="inline-flex items-center gap-x-1.5 rounded-control bg-surface px-2.5 py-1.5 text-sm font-medium text-ink-secondary ring-1 ring-inset ring-edge hover:bg-surface-subtle"
          :aria-expanded="moreOpen"
          aria-haspopup="dialog"
          @click.stop="moreOpen = !moreOpen"
          @keydown.escape="moreOpen = false"
        >
          <AppIcon :icon="FunnelIcon" class="size-4 text-ink-tertiary" aria-hidden="true" />
          Filters
          <span
            v-if="moreCount"
            class="rounded-full bg-brand-50 px-1.5 text-xs font-semibold text-brand-700 ring-1 ring-inset ring-brand-600/20"
            >{{ moreCount }}</span
          >
        </button>
        <Teleport to="body">
          <template v-if="moreOpen">
            <button type="button" class="fixed inset-0 z-scrim" aria-label="Close more filters" @click.stop="moreOpen = false" />
            <div
              ref="panelRef"
              :style="floatingStyles"
              class="z-popover w-72 rounded-control bg-surface p-4 text-sm shadow-overlay ring-1 ring-edge-subtle"
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
        class="group inline-flex items-center gap-1 rounded-control bg-surface-muted py-0.5 pr-1 pl-2 text-xs font-medium text-ink-secondary ring-1 ring-inset ring-edge hover:bg-selected-surface"
        :aria-label="`Remove filter ${c.label}: ${c.value}`"
        @click="emit('remove', c.key)"
      >
        <span class="text-ink-muted">{{ c.label }}:</span>
        {{ c.value }}
        <AppIcon :icon="XMarkIcon" class="size-3.5 text-ink-tertiary group-hover:text-ink-secondary" aria-hidden="true" />
      </button>
      <BaseButton variant="ghost" size="sm" @click="emit('clear-all')">Clear all</BaseButton>
    </div>
  </component>
</template>
