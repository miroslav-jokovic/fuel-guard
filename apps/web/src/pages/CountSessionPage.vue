<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import ShelfWalk from "@/features/inventory/ShelfWalk.vue";
import UnitCheck from "@/features/inventory/UnitCheck.vue";
import { useCountSessionQuery } from "@/features/inventory/useInventory";

/**
 * A walk, on a phone — of a shelf or of a truck (D-INV19; INVENTORY-PLAN.md I5 PR 2b and I9).
 *
 * ── ONE SESSION COMPONENT, TWO BODIES, AND WHY THAT IS WHAT D-INV19 MEANS ─────────────────────
 * The decision reads "one session component serves parts (I5) and units (I9)", and the reason it
 * gives is that two components drift: one grows a recount badge and the other does not, and neither
 * author sees the difference. That reason is about the SESSION — the walk's shape, its promise to
 * keep what was typed, its irreversible close — and none of it is about the item in front of the
 * technician's thumb.
 *
 * And the item is where the two genuinely differ. A shelf count types a quantity per bin against a
 * hidden expected figure and lands a `counted` part movement; a unit check taps Found or Not here
 * per thing and lands an `asset_movements` row, or none at all. Making one component do both would
 * have produced a screen with two modes and two vocabularies — the shape §2.3's worked example
 * warns about, where three reasonable local decisions add up to one unusable surface.
 *
 * So this is the one component the decision asks for: one route, one place that reads the session
 * and decides, and — in `useWalk` and `WalkHeader.vue` — one implementation of everything the two
 * walks share. What cannot drift is the part D-INV19 was worried about.
 *
 * ⚠ The route does NOT change while a walk is open (D-INV17). Everything either body does happens
 * here, because a route change on a screen holding a wake lock and an unsent queue loses both.
 */

const route = useRoute();
const sessionId = computed(() => String(route.params.sessionId ?? ""));
const { data: walk, isLoading, isError } = useCountSessionQuery(sessionId);
</script>

<template>
  <div v-if="isError" class="text-sm text-ink">That walk is not on file.</div>
  <div v-else-if="isLoading" class="text-sm text-ink-tertiary">Loading…</div>
  <UnitCheck v-else-if="walk?.kind === 'unit'" />
  <ShelfWalk v-else />
</template>
