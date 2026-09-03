<script setup lang="ts">
/**
 * Reconcile a vendor file, as a drawer on the Statements tab (FUEL-C5, D-FUI4).
 *
 * ── WHY IT STOPPED BEING A TAB ──────────────────────────────────────────────────────────────────
 * It is an UPLOAD, and every other upload in this plan is a drawer (D-FUI3, and C4 moved three of
 * them). As a tab it also had to be excepted from everything else on the page: the filter bar, the
 * rollup-freshness line and the coverage line were all suppressed on it (`tab !== 'reconcile'`),
 * because a period control means nothing while you are reading a file. Three special cases for one
 * tab is the page telling you it is not a view of the same data.
 *
 * ── WHY ON STATEMENTS AND NOT IN THE PAGE HEADER ────────────────────────────────────────────────
 * Statements is where the file GOES and where its absence is felt: the empty state on that tab is
 * the one sentence in the section that says "this view needs the vendor's weekly statement". Putting
 * the action next to that sentence is the whole point — the reader who needs it is looking at it.
 *
 * No gate: `/fuel-spend` is catalogued `manage("fuel")`, so every caller who can open this page can
 * already do this. Unlike C2 and C4, this relocation does not cross a permission boundary — it moves
 * within one page.
 */
import SlideOver from "@/components/SlideOver.vue";
import ReconcileTab from "./ReconcileTab.vue";

defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: []; saved: [] }>();
</script>

<template>
  <SlideOver
    :open="open"
    size="lg"
    title="Reconcile a file"
    description="A Pilot / Flying J weekly statement or monthly export, checked line by line against your recorded fills."
    @close="emit('close')"
  >
    <!-- `saved` is forwarded rather than swallowed: the statements list behind this drawer refetches
         on it, so the file appears in the list the reader came from without a reload. -->
    <ReconcileTab @saved="emit('saved')" />
  </SlideOver>
</template>
