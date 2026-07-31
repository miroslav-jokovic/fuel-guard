<script setup lang="ts">
import { computed } from "vue";
import { HAZMAT_LOAD_STATUS_LABELS, type HazmatLoadStatus } from "@fuelguard/shared";
import { BADGE_BASE, toneClass } from "@/lib/badges";

/** Load-status chip (plan H5), colored via the shared semantic tones. */
const props = defineProps<{ status: string }>();

const TONE: Record<string, string> = {
  draft: "neutral",
  submitted: "brand",
  extracting: "warning",
  needs_review: "warning",
  cleared: "success",
  rejected: "danger",
  superseded: "neutral",
  cancelled: "neutral",
};

const label = computed(() => HAZMAT_LOAD_STATUS_LABELS[props.status as HazmatLoadStatus] ?? props.status);
const tone = computed(() => TONE[props.status] ?? "neutral");
</script>

<template>
  <span :class="[BADGE_BASE, toneClass(tone), '!capitalize']">{{ label }}</span>
</template>
