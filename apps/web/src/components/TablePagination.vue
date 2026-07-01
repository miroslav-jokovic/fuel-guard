<script setup lang="ts">
import { computed } from "vue";
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
      <span class="hidden text-sm text-gray-500 sm:inline">Page {{ page }} of {{ totalPages }}</span>
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
