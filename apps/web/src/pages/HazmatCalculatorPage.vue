<script setup lang="ts">
import PageHeader from "@/components/ui/PageHeader.vue";
import HazmatCalculatorForm from "@/features/hazmat/HazmatCalculatorForm.vue";
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Enter the vehicle context and regulated products to calculate placards, ID displays, compatibility, and eligibility." />

    <HazmatCalculatorForm fleet />
  </div>
</template>
