<script setup lang="ts">
/**
 * "Check an invoice" — the upload, as a drawer on the Pilot invoices page (FS3, D-FSV8).
 *
 * It was "Reconcile a file" on Fuel Spend's Statements tab (FUEL-C5, D-FUI4), and an upload is still a
 * drawer for the reason it became one: every other upload in the product is (D-FUI3). What changed is
 * where the result goes. The drawer forwards the recorded run's id and the page opens that saved check,
 * so nothing found lives only in here.
 *
 * Opened behind `session.can("fuel")`: the API's two POST routes are `requireSection("fuel")`, which
 * is manage.
 */
import SlideOver from "@/components/SlideOver.vue";
import InvoiceUpload from "./InvoiceUpload.vue";

defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: []; recorded: [runId: string] }>();
</script>

<template>
  <SlideOver
    :open="open"
    size="lg"
    title="Check an invoice"
    description="A Pilot / Flying J weekly invoice or monthly export, checked line by line against your recorded fills."
    @close="emit('close')"
  >
    <InvoiceUpload @recorded="(id) => emit('recorded', id)" />
  </SlideOver>
</template>
