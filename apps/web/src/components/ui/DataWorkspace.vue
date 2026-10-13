<script setup lang="ts">
import { AppCard } from "@silvicom/ui";
import { provideWorkspaceTable } from "@/components/ui/workspaceTable";

// The toolbar's count waits on the table's answer (F15) — see workspaceTable.ts.
provideWorkspaceTable();
</script>

<template>
  <AppCard as="section" padding="none" class="divide-y divide-edge-subtle">
    <slot />
  </AppCard>
</template>
