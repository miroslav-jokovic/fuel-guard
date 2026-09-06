<script setup lang="ts">
/**
 * The price and truck-stop uploads, in one drawer on Truck Stops (FUEL-C4, D-FUI3).
 *
 * ── WHY THEY MOVED, AND WHY THEY MOVED HERE ─────────────────────────────────────────────────────
 * These two cards were the second tab of `/import` — a page whose title was a verb applied to a file
 * format, and whose two tabs had nothing to do with each other beyond both accepting a file. What
 * they produce is the truck-stop registry and its posted prices, which is exactly what the page they
 * now open from displays. A reader who notices a price is wrong is on Truck Stops when they notice.
 *
 * Both cards are UNCHANGED — `PriceUploadCard` keeps its sequential multi-file loop and its
 * per-file outcome list, `StationDataCard` keeps the locations export, the posted-price upload and
 * the three live fetches. C4 moves capabilities; it does not rewrite them.
 *
 * ⚠ **Gated on `can("dispatch")`, and that is derived rather than chosen.** `/api/fueling/prices`
 * is `requireRole("admin", "fleet_manager", "dispatcher")`, and in the shipped matrix those three
 * are exactly the roles with `dispatch: "manage"` — so the section gate EQUALS the role list rather
 * than approximating it, which is the condition CLAUDE.md sets for reading one as the other. Truck
 * Stops itself is catalogued at `section("dispatch")` VIEW, so an auditor keeps the page and does
 * not get the uploads. (The hardcoded list in that route is the permissions plan's S7 to remove, not
 * this step's.)
 */
import SlideOver from "@/components/SlideOver.vue";
import PriceUploadCard from "./PriceUploadCard.vue";
import StationDataCard from "./StationDataCard.vue";

defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <SlideOver
    :open="open"
    size="lg"
    title="Upload prices and locations"
    description="Daily Pilot price reports, the truck-stop registry, and posted retail prices."
    @close="emit('close')"
  >
    <div class="space-y-4">
      <PriceUploadCard />
      <StationDataCard />
    </div>
  </SlideOver>
</template>
