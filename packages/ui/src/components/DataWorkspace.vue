<script setup lang="ts">
import AppCard from "./AppCard.vue";
import { provideWorkspaceTable } from "../lists/workspaceTable";

// The toolbar's count waits on the table's answer (F15) — see workspaceTable.ts.
provideWorkspaceTable();
</script>

<template>
  <AppCard as="section" padding="none" class="divide-y divide-edge-subtle">
    <slot />
  </AppCard>
</template>
