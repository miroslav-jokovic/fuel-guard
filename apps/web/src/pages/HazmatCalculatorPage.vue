<script setup lang="ts">
import PageHeader from "@/components/ui/PageHeader.vue";
import BaseButton from "@/components/ui/BaseButton.vue";
import HazmatCalculatorForm from "@/features/hazmat/HazmatCalculatorForm.vue";

/**
 * Placard Calculator (plan H5) — the first HazmatGuard UI surface. A dispatcher declares a load by hand
 * and the deterministic engine returns placards, ID displays, segregation and eligibility with CFR
 * citations, no AI in the path. The form itself lives in HazmatCalculatorForm (shared with the public M7
 * calculator); this page is just the authenticated chrome around it.
 */
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Enter a load by hand to get required placards, ID displays, segregation and citations.">
      <template #actions>
        <BaseButton variant="ghost" size="sm" to="/hazmat">← HazmatGuard</BaseButton>
      </template>
    </PageHeader>

    <HazmatCalculatorForm />
  </div>
</template>
