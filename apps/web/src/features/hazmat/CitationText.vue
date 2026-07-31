<script setup lang="ts">
import type { Citation } from "@hazmat/engine";

/**
 * The citation chips behind every verdict item (G4 — every answer carries its CFR authority). Each chip
 * shows the CFR reference (and any PHMSA interpretation letter that modifies the rule). The eCFR deep
 * link lets a reviewer read the rule text; the D12 reference-text endpoint can back this inline later.
 */
withDefaults(defineProps<{ citations: Citation[]; label?: string }>(), { label: "Why?" });

/** eCFR resolves a section from its number (e.g. "49 CFR 172.504(f)" → section 172.504). */
function ecfrHref(cfr: string): string | null {
  const m = cfr.match(/(\d+)\s*CFR\s*(\d+)\.(\d+)/i);
  if (!m) return null;
  return `https://www.ecfr.gov/current/title-${m[1]}/section-${m[2]}.${m[3]}`;
}
</script>

<template>
  <div v-if="citations.length" class="flex flex-wrap items-center gap-1.5">
    <span class="text-xs font-medium text-ink-subtle">{{ label }}</span>
    <template v-for="(c, i) in citations" :key="i">
      <a
        v-if="ecfrHref(c.cfr)"
        :href="ecfrHref(c.cfr)!"
        target="_blank"
        rel="noopener noreferrer"
        class="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-xs text-ink-secondary ring-1 ring-inset ring-edge hover:text-brand-600"
      >
        {{ c.cfr }}<span v-if="c.interpretation" class="text-ink-subtle"> · {{ c.interpretation }}</span>
      </a>
      <span
        v-else
        class="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-xs text-ink-secondary ring-1 ring-inset ring-edge"
      >
        {{ c.cfr }}<span v-if="c.interpretation" class="text-ink-subtle"> · {{ c.interpretation }}</span>
      </span>
    </template>
  </div>
</template>
