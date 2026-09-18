<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { AppTabs } from "@silvicom/ui";

/**
 * One recruitment page, three views (D-HUI8, B4).
 *
 * ── WHAT THIS REPLACES, AND WHY IT IS NOT A DELETION ──────────────────────────────────────────
 * `/recruitment`, `/recruitment/screening` and `/recruitment/inquiries` were three sidebar entries
 * for one job. D-HUI8's ruling is that the two behind the board *"stop being nav destinations and
 * become tabs"* — and, in the same breath, that they are **not deleted**: both are real fleet-wide
 * work queues, and `RECRUITING-UI-SURFACE-PLAN.md`'s U2 revert is the precedent it cites. *The
 * panel's CONTENT was not rejected — only its address.*
 *
 * ── WHY THE TABS NAVIGATE INSTEAD OF SWAPPING A PANEL IN PLACE ────────────────────────────────
 * ⚠ This is the one deviation in B4 and it is deliberate, so it is written here rather than left to
 * be discovered. The obvious reading of "tabs" is `v-if` over three panels on one route. Three
 * things argue against it and none of them is preference:
 *
 *   1. **Both siblings are pages, with their own `PageHeader`.** `lint:ui-adoption` requires exactly
 *      one per routed page, so they would have to be rewritten into panel components before they
 *      could be embedded — a day's work on two files this step does not otherwise touch, and
 *      `InquiryQueuePage` alone is 184 lines of queue logic that has nothing to do with the board.
 *   2. **The URLs are live.** Both were registered in an incident (P0b, 2026-08-20) precisely
 *      because they fell through to nothing, and a notification can still link at either. Keeping
 *      the routes keeps every one of those links working, and keeps each view addressable — which
 *      a `v-if` tab would take away.
 *   3. The repo already models this: a screen reached from another one with the same grant is a
 *      `parent` surface (D-SURF8), which is exactly what these two became in `surfaces.ts`.
 *
 * What a person sees is what D-HUI8 asked for — one entry in the sidebar, three tabs above one
 * table. What the router sees is three routes. If the two siblings are ever rebuilt as panels, this
 * component is the only thing that has to change.
 *
 * ⚠ It is a FEATURE component, not a shared primitive (D-HUI2/D-DS18): nothing else has three tabs
 * over three routes yet, and a second consumer is what promotes it.
 */

const route = useRoute();
const router = useRouter();

/**
 * ⚠ Keyed by route NAME rather than by path. `/recruitment/:id` is a real route under the same
 * prefix, so a path-prefix test would light the Screening tab for an applicant whose id happened to
 * start with the right letters, and a `startsWith` chain would be a second copy of the route table.
 */
const TABS = [
  { value: "recruitment", label: "Applicants" },
  { value: "screening-readiness", label: "Screening readiness" },
  { value: "inquiry-queue", label: "Safety-history inquiries" },
] as const;

/**
 * The applicant record has no tab of its own and must not light one — it is a row of the first tab,
 * not a fourth view. Falling back to `recruitment` there keeps the strip honest: the reader came
 * from Applicants and Back goes there.
 */
const current = computed({
  get: () => {
    const name = String(route.name ?? "");
    return TABS.some((t) => t.value === name) ? name : "recruitment";
  },
  set: (value: string) => {
    if (value !== route.name) void router.push({ name: value });
  },
});
</script>

<template>
  <AppTabs v-model="current" :tabs="[...TABS]" label="Recruitment views" />
</template>
