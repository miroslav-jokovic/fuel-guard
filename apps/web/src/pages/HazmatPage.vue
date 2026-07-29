<script setup lang="ts">
import PageHeader from "@/components/ui/PageHeader.vue";

/**
 * HazmatGuard (Phase H0). An entitlement-gated placeholder that proves the module is enabled for this
 * org and reachable in the nav. The BOL pre-check, load-eligibility and placard-calculator surfaces
 * arrive with H2–H5.
 */
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Bill-of-lading pre-check, load eligibility & placarding." />

    <div class="rounded-lg border border-dashed border-edge bg-surface-muted/40 px-6 py-12 text-center">
      <p class="text-sm font-medium text-ink">HazmatGuard is being built.</p>
      <p class="mx-auto mt-1 max-w-md text-sm text-ink-muted">
        The BOL pre-check, load-eligibility and placard-calculator surfaces arrive with Phases H2–H5.
        This page confirms your plan includes HazmatGuard and the module is enabled for your organization.
      </p>
    </div>
  </div>
</template>
