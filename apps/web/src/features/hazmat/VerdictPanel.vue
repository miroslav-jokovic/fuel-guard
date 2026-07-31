<script setup lang="ts">
import { computed } from "vue";
import BaseCard from "@/components/ui/BaseCard.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import type { CalcResult } from "./useHazmatCalc";
import PlacardDiamond from "./PlacardDiamond.vue";
import CitationText from "./CitationText.vue";
import FindingRow from "./FindingRow.vue";

/**
 * The verdict panel (plan H5). Renders the deterministic engine output — required placards (as DOT
 * diamonds), ID-number displays, optional wording substitutions, prohibited placards, marks, ERG guides,
 * eligibility, segregation — each with its CFR citation (G4). The full rule trace sits behind an expander
 * for audit/explainability. Everything here is display; the engine already decided.
 */
const props = defineProps<{ result: CalcResult }>();

const v = computed(() => props.result.verdict);

function humanize(s: string): string {
  return s.replace(/_/g, " ");
}

const ELIGIBILITY_TONE: Record<string, string> = {
  eligible: "success",
  blocked: "danger",
  not_checked: "neutral",
};
const ELIGIBILITY_LABEL: Record<string, string> = {
  eligible: "Eligible",
  blocked: "Blocked",
  not_checked: "Not checked",
};

const firedTrace = computed(() => v.value.trace.filter((t) => t.fired));
</script>

<template>
  <div class="space-y-4">
    <!-- provenance / provisional -->
    <div class="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
      <span>Engine {{ result.engineVersion }}</span>
      <span aria-hidden="true">·</span>
      <span>Dataset {{ result.datasetVersion }}</span>
      <span v-if="result.datasetProvisional" :class="[BADGE_BASE, toneClass('warning')]">
        Provisional dataset — decision support only, cannot clear a load
      </span>
    </div>

    <!-- required placards -->
    <BaseCard>
      <h3 class="text-sm font-semibold text-ink">Required placards</h3>
      <p v-if="v.placards.required.length === 0" class="mt-2 text-sm text-ink-muted">
        No placards required for this load.
      </p>
      <div v-else class="mt-3 flex flex-wrap gap-5">
        <div v-for="(p, i) in v.placards.required" :key="i" class="flex flex-col items-center gap-1.5">
          <PlacardDiamond :name="p.placard" />
          <p class="text-center text-xs text-ink-muted">{{ humanize(p.positions) }}</p>
          <CitationText :citations="p.because" />
        </div>
      </div>
    </BaseCard>

    <!-- ID displays -->
    <BaseCard v-if="v.placards.idDisplays.length">
      <h3 class="text-sm font-semibold text-ink">Identification-number displays</h3>
      <ul class="mt-2 space-y-2">
        <li v-for="(d, i) in v.placards.idDisplays" :key="i" class="text-sm">
          <span class="font-mono font-semibold text-ink">{{ d.idNumber }}</span>
          <span class="text-ink-secondary"> — {{ humanize(d.format) }}, {{ humanize(d.positions) }}</span>
          <div class="mt-0.5"><CitationText :citations="d.because" /></div>
        </li>
      </ul>
    </BaseCard>

    <!-- optional substitutions -->
    <BaseCard v-if="v.placards.optionalSubstitutions.length">
      <h3 class="text-sm font-semibold text-ink">Optional wording substitutions</h3>
      <ul class="mt-2 space-y-2">
        <li v-for="(s, i) in v.placards.optionalSubstitutions" :key="i" class="text-sm text-ink-secondary">
          May use <span class="font-semibold text-ink">{{ humanize(s.use) }}</span> instead of
          <span class="font-semibold text-ink">{{ humanize(s.instead) }}</span>
          <div class="mt-0.5"><CitationText :citations="s.because" /></div>
        </li>
      </ul>
    </BaseCard>

    <!-- prohibited -->
    <BaseCard v-if="v.placards.prohibited.length">
      <h3 class="text-sm font-semibold text-ink">Prohibited placards</h3>
      <ul class="mt-2 space-y-2">
        <li v-for="(p, i) in v.placards.prohibited" :key="i" class="text-sm text-ink-secondary">
          <span :class="[BADGE_BASE, toneClass('danger')]">{{ humanize(p.placard) }}</span>
          <div class="mt-0.5"><CitationText :citations="p.because" /></div>
        </li>
      </ul>
    </BaseCard>

    <!-- marks -->
    <BaseCard v-if="v.placards.marks.length">
      <h3 class="text-sm font-semibold text-ink">Marks (not placards)</h3>
      <ul class="mt-2 space-y-2">
        <li v-for="(m, i) in v.placards.marks" :key="i" class="text-sm text-ink-secondary">
          <span class="font-semibold text-ink">{{ humanize(m.mark) }}</span> — {{ humanize(m.positions) }}
          <div class="mt-0.5"><CitationText :citations="m.because" /></div>
        </li>
      </ul>
    </BaseCard>

    <!-- ERG guides -->
    <BaseCard v-if="v.placards.ergGuides.length">
      <h3 class="text-sm font-semibold text-ink">Emergency Response Guide</h3>
      <ul class="mt-2 flex flex-wrap gap-2 text-sm">
        <li v-for="(g, i) in v.placards.ergGuides" :key="i" class="rounded bg-surface-muted px-2 py-1 ring-1 ring-inset ring-edge">
          <span class="font-mono">{{ g.idNumber }}</span> → Guide <span class="font-semibold">{{ g.guide }}</span>
        </li>
      </ul>
    </BaseCard>

    <!-- eligibility -->
    <BaseCard>
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold text-ink">Eligibility</h3>
        <span :class="[BADGE_BASE, toneClass(ELIGIBILITY_TONE[v.eligibility.status] ?? 'neutral')]">
          {{ ELIGIBILITY_LABEL[v.eligibility.status] ?? v.eligibility.status }}
        </span>
      </div>
      <p v-if="v.eligibility.status === 'not_checked'" class="mt-2 text-sm text-ink-muted">
        Eligibility needs a company policy (H8) — the calculator runs in pure placard mode.
      </p>
      <div v-if="v.eligibility.blocks.length" class="mt-2">
        <FindingRow v-for="(f, i) in v.eligibility.blocks" :key="i" :finding="f" />
      </div>
    </BaseCard>

    <!-- segregation -->
    <BaseCard>
      <h3 class="text-sm font-semibold text-ink">Load compatibility (segregation)</h3>
      <p v-if="v.segregation.length === 0" class="mt-2 text-sm text-ink-muted">
        No segregation conflicts for this product mix.
      </p>
      <div v-else class="mt-1">
        <FindingRow v-for="(f, i) in v.segregation" :key="i" :finding="f" />
      </div>
    </BaseCard>

    <!-- trace -->
    <BaseCard>
      <details>
        <summary class="cursor-pointer text-sm font-semibold text-ink">
          Rule trace ({{ firedTrace.length }} of {{ v.trace.length }} rules fired)
        </summary>
        <ul class="mt-3 space-y-2">
          <li v-for="(t, i) in v.trace" :key="i" class="border-b border-edge pb-2 text-sm last:border-0">
            <div class="flex items-center gap-2">
              <span :class="[BADGE_BASE, toneClass(t.fired ? 'brand' : 'neutral')]">{{ t.fired ? "fired" : "—" }}</span>
              <span class="font-mono text-xs text-ink-secondary">{{ t.ruleId }}</span>
            </div>
            <p v-if="t.note" class="mt-1 text-ink-muted">{{ t.note }}</p>
            <div class="mt-1"><CitationText :citations="t.citations" label="Cites" /></div>
          </li>
        </ul>
      </details>
    </BaseCard>
  </div>
</template>
