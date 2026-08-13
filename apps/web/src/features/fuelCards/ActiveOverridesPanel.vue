<script setup lang="ts">
import { computed, ref } from "vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { activeOverrides } from "./cardControlModel";
import { useEfsCards } from "./useEfsCards";

/**
 * Every active fuel exception on the account, in one place (audit B3).
 *
 * The fact this panel exists for: an override is free fuel, granted one card at a time — in this
 * product, in the WEX portal, by anyone with access — and until now the only way to see them all was
 * to sort a 199-row table by a column. An auditor's question is account-shaped ("who can currently
 * buy outside their limits?"), so the answer should be too.
 *
 * ── Its own query, NOT the page's ────────────────────────────────────────────────────────────────
 * The inventory below this panel filters server-side by search and status. This panel deliberately
 * runs the UNFILTERED list query: an operator who has narrowed the page to "Hold" cards must still
 * see the exception on an Active card — an account-wide claim built from a filtered response would
 * be silently wrong exactly when someone is mid-investigation. When the page is unfiltered the two
 * queries share one cache key, so the common case costs nothing extra. Freshness comes with the
 * same 60s poll as everything else (B6) — no refresh button here either.
 *
 * READ-ONLY by design. Granting and clearing stay in the card drawer with its confirmation copy,
 * step-up rules and idempotency keys; a quick "clear" button here would bypass none of them but
 * would invite clearing the wrong card from a list of look-alike last-fours.
 */

// Unfiltered on purpose — see the docblock. Refs are stable for the component's lifetime.
const query = useEfsCards({ search: ref(""), status: ref("") });

const rows = computed(() => activeOverrides(query.data.value?.cards ?? []));

/** Loaded once ever — after that, cached data keeps rendering through background refetches. */
const loaded = computed(() => query.data.value !== undefined);
</script>

<template>
  <!-- Nothing renders before first data: a flash of "No exceptions" that corrects itself to two
       rows teaches operators the panel guesses. Absence of the panel claims nothing. -->
  <section v-if="loaded" class="space-y-3">
    <div class="flex items-baseline gap-2">
      <h2 class="text-sm font-semibold text-ink">Active fuel exceptions</h2>
      <span v-if="rows.length > 0" :class="[BADGE_BASE, toneClass('warning')]">{{ rows.length }}</span>
    </div>

    <!-- The empty state is a positive assertion, not a hidden panel: "none" is the answer an
         auditor is looking for, and silence is indistinguishable from "didn't check". -->
    <p v-if="rows.length === 0" class="text-sm text-ink-muted">
      No card currently carries a fuel exception.
    </p>

    <ul v-else class="divide-y divide-edge rounded-control border border-edge bg-surface">
      <li v-for="row in rows" :key="row.id">
        <RouterLink
          :to="`/fuel-cards/${row.id}`"
          class="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-left text-sm hover:bg-surface-subtle"
        >
          <span class="font-medium text-ink">{{ row.maskedRef }}</span>
          <span class="text-ink-muted">{{ row.driverName ?? row.unitPrompt ?? "Unassigned" }}</span>
          <span :class="[BADGE_BASE, toneClass('warning')]">
            {{ row.uses }} use{{ row.uses === 1 ? "" : "s" }} left
          </span>
          <span class="text-ink-muted">{{ row.scopeLabel }}</span>
        </RouterLink>
      </li>
    </ul>
  </section>
</template>
