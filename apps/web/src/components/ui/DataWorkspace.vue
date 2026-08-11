<script setup lang="ts">
import { AppCard } from "@fuelguard/ui";
</script>

<template>
  <AppCard as="section" padding="none" class="divide-y divide-edge-subtle">
    <slot />
  </AppCard>
</template>
