<script setup lang="ts">
import { computed } from "vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import HazmatCalculatorForm from "@/features/hazmat/HazmatCalculatorForm.vue";
import BolReadPanel from "@/features/hazmat/bolRead/BolReadPanel.vue";
import { useSessionStore } from "@/stores/session";

// Sending a document for reading is a `hazmat` manage act — the routes' own gate (documents.ts), read
// from the same APP_SECTIONS matrix, so the panel is absent for exactly the people the API would refuse.
const session = useSessionStore();
const canRead = computed(() => session.can("hazmat"));
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Enter the vehicle context and regulated products to calculate placards, ID displays, compatibility, and eligibility." />

    <BolReadPanel v-if="canRead" />

    <HazmatCalculatorForm fleet />
  </div>
</template>
