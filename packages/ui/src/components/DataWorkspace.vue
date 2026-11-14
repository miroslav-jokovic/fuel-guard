<script setup lang="ts">
import AppCard from "./AppCard.vue";
import { provideWorkspaceTable } from "../lists/workspaceTable";

// The toolbar's count waits on the table's answer (F15) — see workspaceTable.ts.
//
// One surface at a desk. When the table draws its rows as cards (SMALL-SCREENS-PLAN.md D-SM5) the
// surface steps aside and each row carries its own; `.workspace-cards` (tokens' epilogue.css) hands
// one to everything else in the slot — the toolbar, a note, a stat strip. The SAME root either way,
// because swapping the element would remount the table that is reporting, which would report again.
const table = provideWorkspaceTable();
</script>

<template>
  <AppCard
    as="section"
    padding="none"
    :variant="table.cards ? 'flat' : 'bordered'"
    :class="table.cards ? 'workspace-cards space-y-2' : 'divide-y divide-edge-subtle'"
  >
    <slot />
  </AppCard>
</template>
