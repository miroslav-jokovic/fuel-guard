<script setup lang="ts">
/**
 * The dispatcher's dashboard — the tab a dispatcher lands on, and one an admin can open beside the
 * fleet overview (D-DW6, D-DW2).
 *
 * **There is no money on this tab, by construction rather than by gate.** That is the point of the
 * split: a dispatcher asked for the board, not the books, and the way to give them that is to build
 * a surface that has no currency figure on it at all — not to build one and then hide half of it.
 * `moneyGate.ts` exists for the fleet tab, which legitimately carries both.
 *
 * ⚠ **The map is deliberately a placeholder and says so on screen.** LM8 renders real markers from
 * `vehicle_positions`, which LM2 creates and LM4's 5-second Samsara tier fills; neither has shipped.
 * An empty map that looked like a working one would be the worse failure — a dispatcher would read
 * "no trucks" as a fact about the fleet rather than as a feature that is not finished. So it states
 * what it is waiting for, in the product's own voice.
 */
import { AppCard as BaseCard } from "@silvicom/ui";
import { RouterLink } from "vue-router";
import SamsaraFeedLine from "@/components/SamsaraFeedLine.vue";
</script>

<template>
  <div class="space-y-6">
    <!-- The same freshness line the fleet tab carries, scoped to the feed a live map depends on. -->
    <SamsaraFeedLine :feeds="['stats']" />

    <BaseCard as="section">
      <div class="flex min-h-96 flex-col items-center justify-center gap-3 text-center">
        <h2 class="text-lg font-semibold text-ink">Live map</h2>
        <p class="max-w-md text-sm text-ink-muted">
          Every truck's current position, updated continuously. Not connected yet — vehicle positions
          are still being wired up to the Samsara feed.
        </p>
        <RouterLink
          to="/loads"
          class="text-sm font-medium text-brand-600 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          Open loads
        </RouterLink>
      </div>
    </BaseCard>
  </div>
</template>
