<script setup lang="ts">
import { AppCard as BaseCard } from "@silvicom/ui";
import HazmatCalculatorForm from "@/features/hazmat/HazmatCalculatorForm.vue";

/**
 * M7 — the free, public, unauthenticated placard calculator + landing page. Renders in the session-free
 * PublicLayout and talks only to the public API (`/api/public/hazmat/*`). Marketing/SEO surface over the
 * deterministic engine: answers with CFR citations, no login.
 */
</script>

<template>
  <div class="space-y-8">
    <section class="text-center">
      <h1 class="text-2xl font-bold tracking-tight text-ink sm:text-3xl">Free DOT hazmat placard calculator</h1>
      <p class="mx-auto mt-3 max-w-2xl text-sm text-ink-muted">
        Enter what you're hauling and get the required DOT placards, ID-number displays, segregation and
        eligibility — every result cited to the exact 49 CFR section. No login, no sign-up.
      </p>
      <div class="mx-auto mt-4 flex max-w-2xl flex-wrap justify-center gap-3 text-xs text-ink-tertiary">
        <span class="rounded-full bg-surface px-3 py-1 ring-1 ring-edge">Answers with CFR citations</span>
        <span class="rounded-full bg-surface px-3 py-1 ring-1 ring-edge">Deterministic — no AI in the verdict</span>
        <span class="rounded-full bg-surface px-3 py-1 ring-1 ring-edge">Free &amp; unauthenticated</span>
      </div>
    </section>

    <HazmatCalculatorForm base-path="/api/public/hazmat" />

    <BaseCard>
      <h2 class="text-sm font-semibold text-ink">How it works</h2>
      <p class="mt-2 text-sm text-ink-muted">
        Every material resolves against the published Hazardous Materials Table (49 CFR §172.101) before it
        can be added — no free-text guessing. The engine applies the §172.500-series placarding rules and
        returns the required placards and the citations behind them. Placard images are specimens for
        identification, not regulation-ready artwork.
      </p>
    </BaseCard>
  </div>
</template>
