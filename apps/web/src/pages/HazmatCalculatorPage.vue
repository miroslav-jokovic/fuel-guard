<script setup lang="ts">
import { AppIcon } from "@fuelguard/ui";
import { ChevronLeftIcon } from "@fuelguard/ui/icons";
import PageHeader from "@/components/ui/PageHeader.vue";
import { AppButton as BaseButton } from "@fuelguard/ui";
import HazmatCalculatorForm from "@/features/hazmat/HazmatCalculatorForm.vue";
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Enter the vehicle context and regulated products to calculate placards, ID displays, compatibility, and eligibility.">
      <template #actions>
        <BaseButton variant="ghost" size="sm" to="/hazmat">
          <AppIcon :icon="ChevronLeftIcon" class="size-4" aria-hidden="true" />
          HazmatGuard
        </BaseButton>
      </template>
    </PageHeader>

    <HazmatCalculatorForm fleet />
  </div>
</template>
