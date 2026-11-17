<script setup lang="ts">
import type { TransponderDto } from "@silvicom/shared";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { tagLabel, tagShortLabel } from "./tollTagLabel";

/**
 * The Vehicles list's Toll tags cell (TOLLS-PER-TRUCK-PLAN.md TL2): the tags on this truck now, short
 * enough for a column, the full number on hover. A dash while the tags are still loading, never "no
 * tags" — a truck whose tags have not been read is not a truck without tags.
 */
defineProps<{ tags: TransponderDto[] | undefined; loaded: boolean }>();
</script>

<template>
  <span v-if="!loaded" class="text-ink-tertiary">—</span>
  <span v-else-if="!tags?.length" class="text-ink-tertiary">None</span>
  <span v-else class="flex flex-wrap gap-1">
    <span v-for="t in tags" :key="t.id" :class="[BADGE_BASE, toneClass('neutral'), 'whitespace-nowrap']" :title="tagLabel(t)">
      {{ tagShortLabel(t) }}
    </span>
  </span>
</template>
