<script setup lang="ts">
withDefaults(
  defineProps<{
    tone?: "danger" | "caution" | "warning" | "success" | "info" | "brand" | "neutral";
  }>(),
  { tone: "neutral" },
);

const tones = {
  danger: "bg-danger-50 text-danger-700 ring-danger-600/20",
  caution: "bg-caution-50 text-caution-700 ring-caution-600/20",
  warning: "bg-warning-50 text-warning-700 ring-warning-600/20",
  success: "bg-success-50 text-success-700 ring-success-600/20",
  info: "bg-info-50 text-info-700 ring-info-600/20",
  brand: "bg-brand-50 text-brand-700 ring-brand-600/20",
  neutral: "bg-surface-subtle text-ink-muted ring-edge",
} as const;
</script>

<!--
  ⚠ NO `capitalize`, and that is load-bearing — LABELS OWN THEIR CASING (contract §7.1).

  It carried one until 2026-09-09 and title-cased every word inside it, so a two-word label read
  correctly in the source and wrongly on screen. It cost three separate workarounds before anybody
  connected them: I5 renamed "Not counted" to the one word "Uncounted" to dodge it; I8 moved the
  asset status pills to `[BADGE_BASE, toneClass(...)]` because there is no one-word way to say
  "In repair"; and I5's own review badge had been shipping "Recount By Someone Else" to the shop for
  a week. `@/lib/badges`' `BADGE_BASE` had the transform removed for exactly this reason in
  2026-08 (recruiting R0b) and this primitive was never brought into line.

  A call site rendering a RAW machine token adds `capitalize` itself — each such site is a
  vocabulary nobody has mapped yet, and it should stay visible rather than be papered over here.
-->
<template>
  <span
    class="inline-flex items-center gap-1 rounded-detail px-2 py-0.5 text-xs font-medium ring-1 ring-inset"
    :class="tones[tone]"
  >
    <slot />
  </span>
</template>
