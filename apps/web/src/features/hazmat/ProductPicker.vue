<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from "vue";
import type { HazmatProduct } from "@silvicom/shared";
import { AppCombobox as ComboSelect } from "@silvicom/ui";
import { useHazmatProductsQuery } from "./useHazmatCalc";

/**
 * HMT product picker (plan H5). Search by UN/NA number or shipping name; the list resolves through
 * `GET /api/hazmat/products` (curated fuel shortlist when blank, full-HMT search when typing).
 * Selecting a row yields a canonical `hmtRef` — there is no free-text entry, so an unknown product
 * simply cannot be added (fail-closed at the source). Exact-substring only; never a fuzzy best-guess.
 *
 * D-H20 (2026-08-30): this used to be a hand-rolled combobox, and every way it differed from the
 * primitive was a defect rather than a requirement — no keyboard support at all (↑/↓/Enter/Escape
 * were dead), `<button role="option">` inside a `role="listbox"`, and a click-away catcher built
 * from `AppButton`, whose `h-9` beat `inset-0` so the "full-screen" backdrop rendered as a visible
 * 36 px bar across the top of the viewport and click-away worked nowhere else. The genuinely
 * different requirement was only that the options come from a server search, which is now
 * `serverFiltered` + `update:query` on `AppCombobox`. The scrim went away entirely: the primitive
 * closes on `focusout`, so there is nothing to mis-size.
 */
const props = withDefaults(defineProps<{ basePath?: string }>(), { basePath: "/api/hazmat" });
const emit = defineEmits<{ select: [product: HazmatProduct] }>();

const query = ref("");
const debounced = ref("");
let timer: ReturnType<typeof setTimeout> | undefined;

// The debounce stays here rather than in the primitive: it is a property of THIS lookup's cost, not
// of comboboxes, and the query key downstream is what actually caches the result.
watch(query, (value) => {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    debounced.value = value;
  }, 200);
});
onBeforeUnmount(() => {
  if (timer) clearTimeout(timer);
});

const { data: products, isFetching, isError } = useHazmatProductsQuery(debounced, props.basePath);

/**
 * The shortlist header the old picker drew above the blank-query results — "a shortcut, not the
 * scope" — is folded into the option labels' surrounding copy instead of a bespoke list header,
 * because the primitive owns the list. The `fuel` marker survives as a label suffix.
 */
const options = computed(() =>
  (products.value ?? []).map((product) => ({
    value: product.hmtRef,
    label: product.isFuelCommon ? `${product.label} · common fuel` : product.label,
  })),
);

const emptyText = computed(() =>
  isError.value
    ? "Lookup failed — try again."
    : "No matching product. Only regulated HMT entries can be added.",
);

const hint = computed(() =>
  query.value.trim() === ""
    ? "Common fuel products are listed first — search any UN/NA number or shipping name to reach the whole Hazardous Materials Table."
    : null,
);

function choose(hmtRef: string) {
  const product = (products.value ?? []).find((p) => p.hmtRef === hmtRef);
  if (!product) return; // fail-closed: an unresolved ref is never emitted as a product
  emit("select", product);
  query.value = "";
  debounced.value = "";
}
</script>

<template>
  <div>
    <ComboSelect
      model-value=""
      :options="options"
      :loading="isFetching"
      :empty-text="emptyText"
      placeholder="Search by UN/NA number or shipping name…"
      server-filtered
      @update:query="query = $event"
      @update:model-value="choose"
    />
    <p v-if="hint" class="mt-1 text-xs text-ink-muted">{{ hint }}</p>
  </div>
</template>
