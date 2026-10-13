<script setup lang="ts">
import type { FieldNote } from "./bolPrefill";

/**
 * The one line under a field the BOL reader filled (§7A N6): where the value came from and whether the two
 * readers agree (`fieldNote`, bolPrefill.ts). Absent on a field nobody read.
 */
defineProps<{ note: FieldNote | null | undefined }>();

const TONE = {
  neutral: "text-ink-muted",
  warning: "text-warning-800",
  success: "text-success-700",
} as const;
</script>

<template>
  <p v-if="note" class="mt-1 text-xs" :class="TONE[note.tone]" data-testid="bol-field-note">{{ note.text }}</p>
</template>
