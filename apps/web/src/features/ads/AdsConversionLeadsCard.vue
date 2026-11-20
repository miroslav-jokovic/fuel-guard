<script setup lang="ts">
import { AppCard as BaseCard, QueryState } from "@silvicom/ui";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { useAdsConversionLeads } from "./useAdsConversionLeads";

/**
 * Ads › Automation's "Meta's qualified-lead goal" (ADS-PLATFORM-V2-PLAN V7e): each thing Meta asks before it
 * optimises for qualified leads instead of form fills, beside what we measured. Shown, never offered: there is no
 * switch, because nobody knows yet whether a job ad may use the goal (Q-AD17) — the card says so in its last line.
 * Every figure and sentence is the API's (shared `conversionLeads.ts`).
 */
const q = useAdsConversionLeads();
const BADGE = { true: ["Met", "success"], false: ["Not yet", "warning"], null: ["Not known", "neutral"] } as const;
const badge = (met: boolean | null) => BADGE[String(met) as "true" | "false" | "null"];
</script>

<template>
  <BaseCard as="section" class="space-y-3" data-test="conversion-leads">
    <h2 class="text-sm font-semibold text-ink">Meta's qualified-lead goal</h2>
    <p class="text-sm text-ink-muted">
      Meta can show the ads to people likely to become qualified leads instead of people likely to fill in a form. It asks
      for each of these first. Nothing here turns it on.
    </p>
    <QueryState
      :loading="q.isLoading.value"
      :error="q.error.value"
      error-text="Could not load the qualified-lead readiness."
      :retrying="q.isFetching.value"
      @retry="q.refetch()"
    >
      <ul v-if="q.data.value" class="divide-y divide-edge-subtle">
        <li v-for="c in q.data.value.checks" :key="c.key" class="flex flex-wrap items-start justify-between gap-2 py-3" :data-test="`check-${c.key}`">
          <div class="min-w-0 space-y-1">
            <p class="text-sm font-medium text-ink">{{ c.needs }}</p>
            <p class="text-sm text-ink-muted">{{ c.measured }}</p>
          </div>
          <span :class="[BADGE_BASE, toneClass(badge(c.met)[1])]">{{ badge(c.met)[0] }}</span>
        </li>
      </ul>
    </QueryState>
  </BaseCard>
</template>
