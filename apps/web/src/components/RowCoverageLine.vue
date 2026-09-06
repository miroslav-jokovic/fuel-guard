<script setup lang="ts">
import type { RowCoverage } from "@silvicom/shared";

/**
 * How much of the list below names a truck, above the list it qualifies (FUEL-T5).
 *
 * ── ABOVE, NOT BELOW ───────────────────────────────────────────────────────────────────────────
 * The same argument `FeedFreshnessLine` and IFTA's health gate both make: a caveat under a list is
 * read after the list has already been believed. This renders before the filter bar, where a reader
 * meets it before they scope anything to a unit.
 *
 * ── AND DELIBERATELY NEVER TONED ───────────────────────────────────────────────────────────────
 * `FeedFreshnessLine` reserves the caution colour for `needsAttention`, and that reservation only
 * works if nothing else spends it. An incomplete attribution share is the NORMAL state of this
 * carrier's data — 339 of 28,620 transaction lines and 696 of 3,445 declines, measured 2026-09-02 —
 * so a caution tone here would be permanently lit, which is how a caution colour stops meaning
 * anything. Whether some threshold of unattributed rows deserves an alarm is a detection question
 * with an owner, not a colour choice; this line states the fact.
 *
 * ── AND SAYS NOTHING RATHER THAN SOMETHING EMPTY ───────────────────────────────────────────────
 * `lead` is null while the count is still loading and for an empty list, where the table's own empty
 * state explains the absence better because it names the filters.
 */
defineProps<{ coverage: RowCoverage | null | undefined }>();
</script>

<template>
  <p v-if="coverage?.lead" class="text-xs text-ink-tertiary">{{ coverage.lead }}</p>
</template>
