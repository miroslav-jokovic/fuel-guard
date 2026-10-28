<script setup lang="ts">
import AppIcon from "./AppIcon.vue";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
} from "../icons";
import { computed, ref, watch } from "vue";
import BaseButton from "./AppButton.vue";
import { useTouchTargets } from "../touchTargets";

/**
 * `total: null` is a keyset-paged list that does not count its rows (Assignment history). It pages on
 * `hasNext` and `pageRows` instead, and says "Showing 51–100" with no "of"; there are no page numbers
 * to jump to without a total.
 *
 * `log` is a time-ordered log addressed by its cursor (D-US12, the Audit log). It has no page
 * number at all, because the page a URL names must reopen the same rows next week, and "page 3" of a
 * log that grows at its newest end does not. So the pager says what the rows ARE (the span of time
 * they cover, formatted by the page) and moves Newer, Older, or back to the Newest.
 */
const props = withDefaults(
  defineProps<{
    page?: number;
    pageSize?: number;
    total: number | null;
    /** A log addressed by its cursor: `span` is the rows' time range, already formatted. */
    log?: { span: string | null; hasNewer: boolean; hasOlder: boolean };
    /** Uncounted mode only: whether a page follows this one. */
    hasNext?: boolean;
    /** Uncounted mode only: rows on this page. */
    pageRows?: number;
    loading?: boolean;
    jumpable?: boolean;
  }>(),
  { page: 1, pageSize: 20, hasNext: false, pageRows: 0, loading: false, jumpable: true, log: undefined },
);
const emit = defineEmits<{ "update:page": [n: number]; newest: []; newer: []; older: [] }>();

const counted = computed(() => props.total !== null);
const totalPages = computed(() => (props.total === null ? null : Math.max(1, Math.ceil(props.total / props.pageSize))));
const shown = computed(() => props.total ?? (props.page - 1) * props.pageSize + props.pageRows);
const from = computed(() => (shown.value === 0 ? 0 : (props.page - 1) * props.pageSize + 1));
const to = computed(() => Math.min(props.page * props.pageSize, shown.value));
const canPrev = computed(() => props.page > 1);
const canNext = computed(() => (totalPages.value === null ? props.hasNext : props.page < totalPages.value));

const go = (n: number) => {
  if (n < 1 || n === props.page) return;
  // Uncounted, only Prev/Next reach this, and Next is disabled without `hasNext`.
  if (totalPages.value !== null && n > totalPages.value) return;
  emit("update:page", n);
};

// "Jump to page" input. Editable draft mirrors the current page; committing (Enter/blur) parses and
// clamps the value to a valid page, then re-syncs the field so it never shows an out-of-range number.
const draft = ref(String(props.page));
watch(
  () => props.page,
  (p) => {
    draft.value = String(p);
  },
);
const commitJump = () => {
  const n = Math.trunc(Number(draft.value));
  if (totalPages.value !== null && Number.isFinite(n) && n >= 1 && n <= totalPages.value) go(n);
  draft.value = String(props.page); // reset invalid/out-of-range input back to the actual page
};

/** Newer/Older/Prev/Next are `AppButton`s and follow the floor themselves; the page box is this file's. */
const touch = useTouchTargets();
</script>

<template>
  <div v-if="log" class="flex flex-wrap items-center justify-between gap-2 border-t border-edge-subtle px-4 py-3 sm:px-6">
    <p class="text-sm text-ink-secondary">
      <span v-if="log.span" class="font-medium">{{ log.span }}</span>
      <template v-else>No results</template>
    </p>
    <div class="flex items-center gap-2">
      <BaseButton v-if="log.hasNewer" size="sm" variant="ghost" :disabled="loading" @click="emit('newest')">
        Newest
      </BaseButton>
      <BaseButton size="sm" :disabled="!log.hasNewer || loading" @click="emit('newer')">
        <AppIcon :icon="ChevronLeftIcon" class="size-4" aria-hidden="true" /> Newer
      </BaseButton>
      <BaseButton size="sm" :disabled="!log.hasOlder || loading" @click="emit('older')">
        Older <AppIcon :icon="ChevronRightIcon" class="size-4" aria-hidden="true" />
      </BaseButton>
    </div>
  </div>
  <div v-else class="flex items-center justify-between border-t border-edge-subtle px-4 py-3 sm:px-6">
    <p class="text-sm text-ink-secondary">
      <template v-if="shown > 0">
        Showing <span class="font-medium">{{ from }}</span>–<span class="font-medium">{{ to }}</span>
        <span v-if="counted"> of <span class="font-medium">{{ total }}</span></span>
      </template>
      <template v-else>No results</template>
    </p>
    <div class="flex items-center gap-3">
      <label v-if="totalPages !== null && totalPages > 1 && jumpable" class="hidden items-center gap-1.5 text-sm text-ink-muted sm:flex">
        <span>Page</span>
        <input
          type="number"
          min="1"
          :max="totalPages"
          inputmode="numeric"
          :value="draft"
          :disabled="loading"
          aria-label="Go to page"
          :class="touch && 'h-12'"
          class="w-14 rounded-control border-0 py-1 text-center text-sm text-ink ring-1 ring-edge-control ring-inset focus:ring-2 focus:ring-focus-ring disabled:opacity-40 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          @input="draft = ($event.target as HTMLInputElement).value"
          @keyup.enter="commitJump"
          @blur="commitJump"
        />
        <span>of {{ totalPages }}</span>
      </label>
      <div class="flex items-center gap-2">
        <BaseButton size="sm" :disabled="!canPrev || loading" @click="go(page - 1)">
          <AppIcon :icon="ChevronLeftIcon" class="size-4" aria-hidden="true" /> Prev
        </BaseButton>
        <BaseButton size="sm" :disabled="!canNext || loading" @click="go(page + 1)">
          Next <AppIcon :icon="ChevronRightIcon" class="size-4" aria-hidden="true" />
        </BaseButton>
      </div>
    </div>
  </div>
</template>
