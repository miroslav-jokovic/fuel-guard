<script setup lang="ts">
import { computed } from "vue";
import type { Verdict } from "@hazmat/engine";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import PlacardDiamond from "./PlacardDiamond.vue";
import CitationText from "./CitationText.vue";

/**
 * The verdict's long tail, behind disclosure (H-U6).
 *
 * These six sections used to be six more `BaseCard`s stacked under the answer, each with the same
 * heading weight and the same elevation as "what goes on the truck" — so a panel that exists to say
 * WHICH DIAMONDS GO ON THE TRUCK gave that answer exactly as much visual authority as its rule
 * trace. Everything here is real and none of it is the answer: it is what a reviewer or an auditor
 * opens when they are checking the answer rather than acting on it.
 *
 * Closed by default and never conditional on a role: a dispatcher who wants the trace can have it,
 * they just do not have to scroll past it at 5am. Sections with nothing in them do not render at
 * all, so the count of disclosures is itself a signal about the load.
 */
const props = defineProps<{ verdict: Verdict }>();

const v = computed(() => props.verdict);
const humanize = (s: string): string => s.replace(/_/g, " ");
const firedTrace = computed(() => v.value.trace.filter((t) => t.fired));
</script>

<template>
  <div class="divide-y divide-edge">
    <!-- permitted but not required (§172.502(c)) -->
    <details v-if="v.placards.permitted.length" class="py-3 first:pt-0 last:pb-0">
      <summary class="cursor-pointer text-sm font-medium text-ink">
        Permitted, not required <span class="text-ink-muted">({{ v.placards.permitted.length }})</span>
      </summary>
      <p class="mt-2 text-xs text-ink-muted">
        Below the 1,001&nbsp;lb Table&nbsp;2 aggregate. You may display these if you choose to — many
        carriers do as a matter of policy.
      </p>
      <div class="mt-3 flex flex-wrap gap-5">
        <div v-for="(p, i) in v.placards.permitted" :key="i" class="flex w-24 flex-col items-center gap-1.5">
          <PlacardDiamond :name="p.placard" :size="72" />
          <CitationText :citations="p.because" />
        </div>
      </div>
    </details>

    <details v-if="v.placards.optionalSubstitutions.length" class="py-3 first:pt-0 last:pb-0">
      <summary class="cursor-pointer text-sm font-medium text-ink">
        Optional wording substitutions <span class="text-ink-muted">({{ v.placards.optionalSubstitutions.length }})</span>
      </summary>
      <ul class="mt-2 space-y-2">
        <li v-for="(s, i) in v.placards.optionalSubstitutions" :key="i" class="text-sm text-ink-secondary">
          May use <span class="font-semibold text-ink">{{ humanize(s.use) }}</span> instead of
          <span class="font-semibold text-ink">{{ humanize(s.instead) }}</span>
          <div class="mt-0.5"><CitationText :citations="s.because" /></div>
        </li>
      </ul>
    </details>

    <details v-if="v.placards.prohibited.length" class="py-3 first:pt-0 last:pb-0">
      <summary class="cursor-pointer text-sm font-medium text-ink">
        Prohibited placards <span class="text-ink-muted">({{ v.placards.prohibited.length }})</span>
      </summary>
      <ul class="mt-2 space-y-2">
        <li v-for="(p, i) in v.placards.prohibited" :key="i" class="text-sm text-ink-secondary">
          <span :class="[BADGE_BASE, toneClass('danger')]">{{ humanize(p.placard) }}</span>
          <div class="mt-0.5"><CitationText :citations="p.because" /></div>
        </li>
      </ul>
    </details>

    <details v-if="v.placards.marks.length" class="py-3 first:pt-0 last:pb-0">
      <summary class="cursor-pointer text-sm font-medium text-ink">
        Marks, which are not placards <span class="text-ink-muted">({{ v.placards.marks.length }})</span>
      </summary>
      <ul class="mt-2 space-y-2">
        <li v-for="(m, i) in v.placards.marks" :key="i" class="text-sm text-ink-secondary">
          <span class="font-semibold text-ink">{{ humanize(m.mark) }}</span> — {{ humanize(m.positions) }}
          <div class="mt-0.5"><CitationText :citations="m.because" /></div>
        </li>
      </ul>
    </details>

    <details v-if="v.placards.ergGuides.length" class="py-3 first:pt-0 last:pb-0">
      <summary class="cursor-pointer text-sm font-medium text-ink">
        Emergency Response Guide <span class="text-ink-muted">({{ v.placards.ergGuides.length }})</span>
      </summary>
      <ul class="mt-2 flex flex-wrap gap-2 text-sm">
        <li v-for="(g, i) in v.placards.ergGuides" :key="i" class="rounded-control bg-surface-muted px-2 py-1 ring-1 ring-inset ring-edge">
          <span class="font-mono">{{ g.idNumber }}</span> → Guide <span class="font-semibold">{{ g.guide }}</span>
        </li>
      </ul>
    </details>

    <details class="py-3 first:pt-0 last:pb-0">
      <summary class="cursor-pointer text-sm font-medium text-ink">
        Rule trace <span class="text-ink-muted">({{ firedTrace.length }} of {{ v.trace.length }} rules fired)</span>
      </summary>
      <ul class="mt-3 space-y-2">
        <li v-for="(t, i) in v.trace" :key="i" class="border-b border-edge pb-2 text-sm last:border-0">
          <div class="flex items-center gap-2">
            <span :class="[BADGE_BASE, toneClass(t.fired ? 'brand' : 'neutral')]">{{ t.fired ? "Fired" : "Not fired" }}</span>
            <span class="font-mono text-xs text-ink-secondary">{{ t.ruleId }}</span>
          </div>
          <p v-if="t.note" class="mt-1 text-ink-muted">{{ t.note }}</p>
          <div class="mt-1"><CitationText :citations="t.citations" label="Cites" /></div>
        </li>
      </ul>
    </details>
  </div>
</template>
