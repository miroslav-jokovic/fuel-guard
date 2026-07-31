<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from "vue";
import type { HazmatProduct } from "@fuelguard/shared";
import BaseInput from "@/components/ui/BaseInput.vue";
import { useHazmatProductsQuery } from "./useHazmatCalc";

/**
 * HMT product picker (plan H5). Search by UN/NA number or shipping name; the list resolves through
 * `GET /api/hazmat/products` (curated fuel shortlist when blank, full-HMT search when typing). Selecting a
 * row yields a canonical `hmtRef` — there is no free-text entry, so an unknown product simply cannot be
 * added (fail-closed at the source). Exact-substring only; never a fuzzy best-guess (resolveHmtLine rule).
 */
const emit = defineEmits<{ select: [product: HazmatProduct] }>();

const query = ref("");
const debounced = ref("");
const open = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;

watch(query, (v) => {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    debounced.value = v;
  }, 200);
});
onBeforeUnmount(() => {
  if (timer) clearTimeout(timer);
});

const { data: products, isFetching, isError } = useHazmatProductsQuery(debounced);

function choose(p: HazmatProduct) {
  emit("select", p);
  query.value = "";
  debounced.value = "";
  open.value = false;
}
</script>

<template>
  <div class="relative">
    <BaseInput
      v-model="query"
      type="search"
      placeholder="Search by UN/NA number or shipping name…"
      autocomplete="off"
      @focus="open = true"
    />
    <div
      v-if="open"
      class="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-md bg-surface shadow-lg ring-1 ring-edge"
      role="listbox"
    >
      <p v-if="isFetching" class="px-3 py-2 text-sm text-ink-muted">Searching…</p>
      <p v-else-if="isError" class="px-3 py-2 text-sm text-danger-600">Lookup failed — try again.</p>
      <p v-else-if="!products || products.length === 0" class="px-3 py-2 text-sm text-ink-muted">
        No matching product. Only regulated HMT entries can be added.
      </p>
      <template v-else>
        <p v-if="!query" class="px-3 pt-2 text-xs font-medium uppercase tracking-wide text-ink-subtle">
          Common fuels
        </p>
        <button
          v-for="p in products"
          :key="p.hmtRef"
          type="button"
          role="option"
          class="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm text-ink hover:bg-surface-subtle"
          @click="choose(p)"
        >
          <span class="truncate">{{ p.label }}</span>
          <span
            v-if="p.isFuelCommon"
            class="shrink-0 rounded bg-surface-muted px-1.5 py-0.5 text-xs font-medium text-ink-subtle ring-1 ring-inset ring-edge"
            >fuel</span
          >
        </button>
      </template>
    </div>
    <!-- click-away backdrop while open -->
    <button v-if="open" type="button" class="fixed inset-0 z-10 cursor-default" tabindex="-1" aria-hidden="true" @click="open = false" />
  </div>
</template>
