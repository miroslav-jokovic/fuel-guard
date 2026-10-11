<script setup lang="ts">
/**
 * A card's door to its page — rendered only when that page opens for the reader (SP5, plan §4b).
 *
 * Every v3 card has one in its header, and before this each card spelled the same `opens()` check
 * and the same link classes out by hand. The DECISION stays `useOpens`'s; this is only its shape.
 * A reader whose org has turned the page off sees no link and no gap: the figure is the
 * dashboard's own and stays, only the promise of a page goes.
 */
import { computed } from "vue";
import { RouterLink } from "vue-router";
import { useOpens } from "@/composables/useOpens";

const props = defineProps<{ to: string }>();
const opens = useOpens();
const shown = computed(() => opens(props.to));
</script>

<template>
  <RouterLink
    v-if="shown"
    :to="to"
    class="whitespace-nowrap rounded-control px-1.5 py-0.5 text-xs font-medium text-link hover:text-link-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
  >
    <slot /> →
  </RouterLink>
</template>
