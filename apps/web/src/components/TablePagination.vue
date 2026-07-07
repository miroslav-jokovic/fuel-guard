<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ChevronLeftIcon, ChevronRightIcon } from "@heroicons/vue/20/solid";

const props = withDefaults(
  defineProps<{ page: number; pageSize?: number; total: number; loading?: boolean }>(),
  { pageSize: 20, loading: false },
);
const emit = defineEmits<{ "update:page": [n: number] }>();

const totalPages = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)));
const from = computed(() => (props.total === 0 ? 0 : (props.page - 1) * props.pageSize + 1));
const to = computed(() => Math.min(props.page * props.pageSize, props.total));
const canPrev = computed(() => props.page > 1);
const canNext = computed(() => props.page < totalPages.value);

const go = (n: number) => {
  if (n >= 1 && n <= totalPages.value && n !== props.page) emit("update:page", n);
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
  if (Number.isFinite(n) && n >= 1 && n <= totalPages.value) go(n);
  draft.value = String(props.page); // reset invalid/out-of-range input back to the actual page
};

const btn =
  "inline-flex items-center gap-x-1 rounded-md bg-white px-2.5 py-1.5 text-sm font-medium text-gray-700 ring-1 ring-gray-300 ring-inset hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40";
</script>

<template>
  <div class="flex items-center justify-between border-t border-gray-100 px-4 py-3 sm:px-6">
    <p class="text-sm text-gray-600">
      <template v-if="total > 0">
        Showing <span class="font-medium">{{ from }}</span>–<span class="font-medium">{{ to }}</span>
        of <span class="font-medium">{{ total }}</span>
      </template>
      <template v-else>No results</template>
    </p>
    <div class="flex items-center gap-3">
      <label v-if="totalPages > 1" class="hidden items-center gap-1.5 text-sm text-gray-500 sm:flex">
        <span>Page</span>
        <input
          type="number"
          min="1"
          :max="totalPages"
          inputmode="numeric"
          :value="draft"
          :disabled="loading"
          aria-label="Go to page"
          class="w-14 rounded-md border-0 py-1 text-center text-sm text-gray-900 ring-1 ring-gray-300 ring-inset focus:ring-2 focus:ring-indigo-500 disabled:opacity-40 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          @input="draft = ($event.target as HTMLInputElement).value"
          @keyup.enter="commitJump"
          @blur="commitJump"
        />
        <span>of {{ totalPages }}</span>
      </label>
      <div class="flex items-center gap-2">
        <button type="button" :class="btn" :disabled="!canPrev || loading" @click="go(page - 1)">
          <ChevronLeftIcon class="size-4" aria-hidden="true" /> Prev
        </button>
        <button type="button" :class="btn" :disabled="!canNext || loading" @click="go(page + 1)">
          Next <ChevronRightIcon class="size-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  </div>
</template>
