<script setup lang="ts">
import AppIcon from "./AppIcon.vue";
import {
  FunnelIcon,
  XMarkIcon,
} from "../icons";
import { computed, ref } from "vue";
import { useEventListener, useMediaQuery } from "@vueuse/core";
import { useFloating, offset, flip, shift, autoUpdate } from "@floating-ui/vue";
import SearchInput from "./AppSearchField.vue";
import BaseCard from "./AppCard.vue";
import BaseButton from "./AppButton.vue";
import { countLabelFor } from "../lists/plural";
import { useWorkspaceTable } from "../lists/workspaceTable";
import { provideFilterStack } from "../lists/filterStack";

/**
 * The standard table toolbar (see docs/DESIGN-SYSTEM-CONTRACT.md). One card:
 *
 *   [ search ] [ primary filter controls … ] [⏷ Filters] ······ count · actions
 *   [ chip: Unit 204 ✕ ] [ chip: Dates Jul 1 – 13 ✕ ]                ← when secondary filters set
 *   "Clear filters" sits before the count whenever `activeCount` > 0.
 *
 * - #filters — the 2–4 PRIMARY dimensions as compact FilterSelect /
 *   DateRangeFilter triggers, live-applied (each shows its active value).
 * - #more — secondary filters, shown in the "Filters" popover (only render
 *   the button when the slot is provided). `moreCount` badges active ones.
 * - chips — removable tokens for the SECONDARY (popover) filters only; the
 *   inline triggers already show their values. Emits `remove(key)`.
 * - activeCount — how many filters (search included) currently narrow the list. While it is
 *   above zero the bar shows ONE "Clear filters" button, which emits `clear-all`.
 * - count — always-visible result feedback ("1,204 transactions", "1 transaction").
 * - #actions — page-level buttons that belong to the table (Export, Rescore…).
 *
 * ── BELOW `md`: THE SEARCH AND ONE "Filters" BUTTON (SMALL-SCREENS-PLAN.md D-SM8, 2026-11-14) ────
 * The owner's audit measured Drivers at 390 px: four filter triggers, two clear buttons, Views and
 * Columns on three lines above the list. So on a phone the page's filters — `#filters` and `#more`
 * alike, a phone has no "secondary" — open in a sheet docked to the bottom, stacked, and the button
 * carries how many are set.
 *
 * ⚠ The sheet is the SAME element the filters sit in at a desk, restyled by `max-md:` classes — not
 * a second copy and not a Teleport. A slot rendered in two places is two sets of controls with two
 * sets of open popovers; and a Teleport would take the filters out of the page's own subtree, where
 * every page test finds them (jsdom has no `matchMedia`, so every test renders the phone branch of
 * anything decided in script). Decided in CSS, the desk markup is untouched and a test sees one DOM.
 *
 * It is this bar's own panel and not `SlideOver`: that lives in `apps/web`, and the list kit cannot
 * import an app (Q-SM2).
 */
export interface FilterChip {
  key: string;
  label: string;
  value: string;
}

const props = withDefaults(
  defineProps<{
    search?: string;
    searchPlaceholder?: string;
    count?: number | null;
    /**
     * The PLURAL noun for the result count, always — "transactions", "shelves", "truck stops".
     * `lists/plural.ts` renders it singular at exactly one, so no caller passes both forms and no
     * caller has to remember that a count of one exists.
     */
    countLabel?: string;
    chips?: FilterChip[];
    moreCount?: number;
    /**
     * How many filters narrow the list right now, the search included. FilterBar owns "Clear
     * filters" because before 2026-10-12 nine pages each drew their own — in `#actions`, inside
     * `#filters`, or as the chip row's "Clear all", which only appeared once a SECONDARY filter was
     * set — and twenty more filtered lists offered no way back at all. The caller still decides
     * what clearing means (`clear-all`); the convention every existing one shared is: every filter
     * and the search, never the sort, because the sort orders the list rather than narrowing it.
     */
    activeCount?: number;
    embedded?: boolean;
  }>(),
  {
    search: undefined,
    searchPlaceholder: "Search…",
    count: null,
    countLabel: "results",
    chips: () => [],
    moreCount: 0,
    activeCount: 0,
    embedded: false,
  },
);
const emit = defineEmits<{
  "update:search": [value: string];
  remove: [key: string];
  "clear-all": [];
}>();

// Inside a DataWorkspace the count waits for the table's answer: "0 vehicles" while the read is
// loading, or after it failed, is a confident wrong answer (F15). A report's standalone bar passes
// null itself until its own reads answer (FuelCostsPage, FuelBuyDisciplinePage).
const table = useWorkspaceTable();
const shownCount = computed(() => (table && (table.loading || table.failed) ? null : props.count));

/* The phone sheet (see the header). `stacked` tells the controls in it to fill the line. */
const isWide = useMediaQuery("(min-width: 768px)");
provideFilterStack(() => !isWide.value);
const sheetOpen = ref(false);
useEventListener("keydown", (e: KeyboardEvent) => {
  if (e.key === "Escape") sheetOpen.value = false;
});
/** Filters set, the search apart — the search is on screen beside the button and needs no count. */
const filterCount = computed(() => Math.max(0, props.activeCount - (props.search?.trim() ? 1 : 0)));

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
    <!-- `lg:flex-wrap`: when the filters and the right-hand group (Clear filters, count, export with
         its scope sentence) cannot share one line, the right-hand group drops to its own line,
         still right-aligned, instead of squeezing the filters onto two or three lines beside it.
         Seen in the browser 2026-10-12 on Fuel costs and Fuel problems at 1440px. -->
    <div class="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center">
      <!-- `lg:contents`: from `lg` the search is a child of the row above, as it always was; below
           it this line is the search and, under `md`, the one Filters button beside it. -->
      <div v-if="search !== undefined || $slots.filters || $slots.more" class="flex items-center gap-2 lg:contents">
        <div v-if="search !== undefined" class="min-w-0 flex-1 lg:w-64 lg:flex-none lg:shrink-0">
          <SearchInput
            :model-value="search"
            :placeholder="searchPlaceholder"
            @update:model-value="emit('update:search', $event)"
          />
        </div>
        <BaseButton
          v-if="$slots.filters || $slots.more"
          variant="secondary"
          class="shrink-0 md:hidden"
          aria-haspopup="dialog"
          :aria-expanded="sheetOpen"
          data-filter-sheet-open
          @click="sheetOpen = true"
        >
          <AppIcon :icon="FunnelIcon" class="size-4 text-ink-tertiary" aria-hidden="true" />
          Filters
          <span
            v-if="filterCount"
            class="rounded-full bg-brand-50 px-1.5 text-xs font-semibold text-brand-700 ring-1 ring-inset ring-brand-600/20"
            >{{ filterCount }}</span
          >
        </BaseButton>
      </div>

      <button
        v-if="sheetOpen"
        type="button"
        class="fixed inset-0 z-scrim bg-scrim/60 md:hidden"
        aria-label="Close filters"
        @click="sheetOpen = false"
      />
      <!-- The filters. A toolbar line from `md` (`md:contents` — the wrapper is not there); below it
           hidden until asked for, then a sheet on the bottom edge. -->
      <div
        v-if="$slots.filters || $slots.more"
        class="md:contents"
        :class="
          sheetOpen
            ? 'max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-popover max-md:max-h-[85vh] max-md:overflow-y-auto max-md:rounded-t-surface max-md:bg-surface max-md:p-4 max-md:pb-[max(1rem,env(safe-area-inset-bottom))] max-md:shadow-dialog'
            : 'max-md:hidden'
        "
        :role="sheetOpen ? 'dialog' : undefined"
        :aria-label="sheetOpen ? 'Filters' : undefined"
        data-filter-sheet
      >
        <!-- The sheet's own chrome exists only while it is open: closed, the bar's DOM is the desk's
             plus one button, and there is one "Clear filters" in the document, not two. -->
        <div v-if="sheetOpen" class="mb-4 flex items-center justify-between gap-3 md:hidden">
          <h2 class="text-sm font-semibold text-ink">Filters</h2>
          <BaseButton v-if="activeCount > 0" variant="ghost" size="sm" @click="emit('clear-all')">Clear filters</BaseButton>
        </div>
        <div v-if="$slots.filters" class="flex flex-wrap items-center gap-2 max-md:flex-col max-md:flex-nowrap max-md:items-stretch max-md:gap-3">
          <slot name="filters" />
        </div>
        <!-- `#more` joins the sheet only while it is open: the desk popover below is the slot's other
             home, and a slot drawn twice is two sets of controls. -->
        <div v-if="$slots.more && sheetOpen" class="mt-3 space-y-3 md:hidden">
          <slot name="more" />
        </div>
        <BaseButton v-if="sheetOpen" variant="primary" class="mt-4 w-full md:hidden" data-filter-sheet-close @click="sheetOpen = false">
          <template v-if="shownCount != null">Show {{ shownCount.toLocaleString() }} {{ countLabelFor(shownCount, countLabel) }}</template>
          <template v-else>Done</template>
        </BaseButton>
      </div>

      <div v-if="$slots.more" class="max-md:hidden">
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
        <BaseButton v-if="activeCount > 0" variant="ghost" size="sm" @click="emit('clear-all')">
          Clear filters
        </BaseButton>
        <span v-if="shownCount != null" class="whitespace-nowrap text-sm text-ink-muted">
          {{ shownCount.toLocaleString() }} {{ countLabelFor(shownCount, countLabel) }}
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
    </div>
  </component>
</template>
