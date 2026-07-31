<script setup lang="ts">
import PageHeader from "@/components/ui/PageHeader.vue";
import BaseCard from "@/components/ui/BaseCard.vue";
import BaseButton from "@/components/ui/BaseButton.vue";

/**
 * HazmatGuard hub. Entitlement-gated (module `hazmatguard`). The Placard Calculator (H5) is the first live
 * surface — a manual, deterministic placard/segregation/eligibility check. The Load Workspace, extraction
 * and review queue arrive with H5's remaining slices and H6–H7.
 */
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Bill-of-lading pre-check, load eligibility & placarding." />

    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <BaseCard>
        <h2 class="text-sm font-semibold text-ink">Placard Calculator</h2>
        <p class="mt-1 text-sm text-ink-muted">
          Declare a load by hand and get the required placards, ID-number displays, load-compatibility
          checks and eligibility — each with its 49 CFR citation. No photos needed.
        </p>
        <div class="mt-4">
          <BaseButton variant="primary" size="sm" to="/hazmat/calculator">Open calculator</BaseButton>
        </div>
      </BaseCard>

      <BaseCard class="opacity-70">
        <h2 class="text-sm font-semibold text-ink">Load Workspace</h2>
        <p class="mt-1 text-sm text-ink-muted">
          Create and track hazmat loads, run analysis, and review findings with attestation. Arriving in a
          later H5 slice.
        </p>
        <div class="mt-4">
          <BaseButton variant="soft" size="sm" disabled>Coming soon</BaseButton>
        </div>
      </BaseCard>
    </div>
  </div>
</template>
