<script setup lang="ts">
import { computed } from "vue";
import { hiringVendorPortal, type HiringStepKey } from "@silvicom/shared";
import { AppLinkArrow } from "@silvicom/ui";

/**
 * Where a step is done when it is done in a vendor's portal — SambaSafety for the driving record, FMCSA's
 * Clearinghouse for the query (HIRING-WORKFLOW-AUDIT §14, D-OF8). The address and the steps are the
 * catalogue's (`HIRING_VENDOR_PORTALS`); this only lays them out above the form that records what came back.
 *
 * ⚠ A new tab, `noopener`: both portals refuse to be framed, so a modal around them would be empty, and the
 * opened tab must not be able to reach back into this one. Renders nothing for a step with no portal.
 */
const props = defineProps<{ step: HiringStepKey }>();
const portal = computed(() => hiringVendorPortal(props.step));
</script>

<template>
  <section
    v-if="portal"
    class="space-y-3 rounded-surface bg-surface-muted p-4"
    :aria-label="`Do it in ${portal.name}`"
    data-testid="vendor-portal"
  >
    <!-- A link, not a button: it goes somewhere (PartOneClearinghouse.vue's pattern). 44 px tall for a tablet. -->
    <a
      :href="portal.url"
      target="_blank"
      rel="noopener noreferrer"
      class="group inline-flex min-h-11 items-center gap-1 text-sm font-medium text-action-primary underline"
      data-testid="vendor-portal-link"
    >Open {{ portal.name }} in a new tab <AppLinkArrow external /></a>
    <ol class="list-decimal space-y-1 pl-5 text-xs text-ink-secondary">
      <li v-for="(s, i) in portal.steps" :key="i">{{ s }}</li>
    </ol>
  </section>
</template>
