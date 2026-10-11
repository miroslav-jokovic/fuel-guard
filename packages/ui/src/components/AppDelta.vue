<script setup lang="ts">
/**
 * The period-over-period delta pill (DR2b; DASHBOARD-TEMPLATE-V2 §4.1, D-DT2/D-DT4/D-DT8; D-DR4).
 *
 * ── NOT A BADGE ──────────────────────────────────────────────────────────────────────────────────
 * `AppBadge` is the STATUS vocabulary (D-UI5), and a badge used for a measurement teaches it a
 * second meaning. A delta is a measurement, so it has its own primitive with its own three tones.
 *
 * ── ONE ENCODING OF MOVEMENT (D-DT2) ─────────────────────────────────────────────────────────────
 * The arrow carries the direction and the colour carries the verdict; the text is the magnitude
 * alone, with no sign — the caller passes "12%", never "+12%". Flat draws a dash and nothing else
 * (D-DT4: "— 0%" says one thing twice).
 *
 * ── THE VERDICT IS THE CALLER'S (D-DT8) ──────────────────────────────────────────────────────────
 * `tone` is passed in, never inferred from `direction`: spend up is bad, MPG up is good, and only
 * the caller knows which tile this is. `@silvicom/shared`'s `deltaTone` is where that is decided.
 *
 * ── THE ARROW IS DECORATIVE; THE DIRECTION IS SPOKEN ─────────────────────────────────────────────
 * A glyph and a colour are nothing to a screen reader, so the pill carries an `sr-only` sentence
 * ("Up 12% versus the previous period") and hides the glyph from the tree. Two readers, one fact.
 */
export type DeltaDirection = "up" | "down" | "flat";
export type DeltaTone = "good" | "bad" | "neutral";

withDefaults(
  defineProps<{
    direction: DeltaDirection;
    tone?: DeltaTone;
    /** The magnitude, already formatted and unsigned: "12%", "0.3". Ignored when flat. */
    label?: string;
    /** What the change is against, for the spoken sentence only. */
    against?: string;
  }>(),
  { tone: "neutral", label: "", against: "the previous period" },
);

const tones = {
  good: "bg-success-50 text-success-700",
  bad: "bg-danger-50 text-danger-700",
  neutral: "bg-surface-subtle text-ink-muted",
} as const;

const glyphs = { up: "↑", down: "↓", flat: "—" } as const;
</script>

<template>
  <span
    class="inline-flex h-5 items-center gap-0.5 rounded-full px-1.5 text-2xs font-semibold tabular-nums"
    :class="tones[tone]"
    :data-direction="direction"
  >
    <span aria-hidden="true">{{ glyphs[direction] }}</span>
    <span v-if="direction !== 'flat' && label" aria-hidden="true">{{ label }}</span>
    <span class="sr-only">
      {{ direction === "flat" ? `No change versus ${against}` : `${direction === "up" ? "Up" : "Down"} ${label} versus ${against}` }}
    </span>
  </span>
</template>
