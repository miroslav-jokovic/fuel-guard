<script setup lang="ts">
import LiveMapWorkspace from "@/features/livemap/LiveMapWorkspace.vue";

/**
 * `/live-map` — the dispatcher's board (LIVE-MAP-PLAN.md LM8, DESIGN-REFRESH-2026-09.md §4).
 *
 * ── THERE IS NO `PageHeader` HERE ANY MORE, AND THAT IS D-DR5 ────────────────────────────────────
 * The page used to be `PageHeader` + `LiveMapPanel` inside the shell's padded document outlet, and
 * the header spent the top 6rem of a workspace restating what the sidebar already said. The route
 * now carries `meta.fullBleed`, so `AppShell` gives `<main>` a height and drops its gutters, and the
 * page is one component filling it. Everything the header used to carry moved to where it belongs:
 * the title is `route.meta.title` (which is where the browser tab already read it from), the
 * description was scenery, and the freshness sentence is a property of the DATA, so it now lives
 * beside the data — see `LiveMapWorkspace`'s dock bar and D-LM18's scope sentence next to it.
 *
 * The page stays this thin on purpose. `LiveMapWorkspace` is the surface, and `LiveMapPanel` is the
 * other reading of the same board that the Dashboard's Dispatch tab embeds (D-DW5): the tab is the
 * glance, the page is the work, and neither substitutes for the other.
 */
</script>

<template>
  <LiveMapWorkspace />
</template>
