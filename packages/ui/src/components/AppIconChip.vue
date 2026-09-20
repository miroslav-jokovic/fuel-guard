<script setup lang="ts">
import AppIcon from "./AppIcon.vue";
import type { Icon } from "../icons";

/**
 * The tinted icon tile that leads a KPI tile, a metric cell or a card header (D-DT17).
 *
 * ── WHY THIS EXISTS: THE CHIP HAD NO VOCABULARY ────────────────────────────────────────────────
 * `AppBadge` and `AppCallout` each take a closed `tone` enum and resolve it through one map. The
 * chip did not: `StatCard`'s `tone` prop was documented as "Tailwind classes for the icon chip,
 * e.g. `text-success-600 bg-success-50`" — an OPEN string, so the colour lived at the call sites
 * rather than in the system. There were **22 of them hand-written across 5 files** when this was
 * counted and replaced (2026-09-20) — `OperatingMetricsWidget`, `KpiHeroWidget`,
 * `MaintenanceHomePage`, `useFindingsSummary` and `StatCard.test.ts` — with
 * `"text-success-600 bg-success-50"` alone appearing six times.
 *
 * ⚠ And the chip was DRAWN in three places, not one: `StatCard`'s hero branch, its KPI branch, and
 * `OperatingMetricsWidget`, which hand-rolled the whole span with a comment arguing that "two
 * surfaces agreeing because one read the other beats two surfaces agreeing by coincidence". True,
 * and a copy is still a copy — it is what made the vocabulary look like two consumers when it was
 * three, and it was the existing test `draws one icon chip per tile, in that tile's own tone` that
 * caught the omission when the tone names changed underneath it.
 *
 * ⚠ `ReconcileTab` looks like a sixth call site and is not: its `tone` is a local `Bucket` type carrying a
 * `ring-*` class and 700/800 steps, never passed to a chip. It was in the first count of this
 * comment and had to be taken back out. A grep for the shape of a class pair finds tone-like
 * strings that answer a different question.
 *
 * That is the register `CLAUDE.md` names by example — a hand-written list beside a vocabulary the
 * system already models correctly. The cost is not the duplication itself but that the chip cannot
 * be RESTYLED: changing how a chip looks meant editing two dozen call sites and hoping none was
 * missed, which is the same thing as saying the chip has no design.
 *
 * ⚠ **This component is deliberately a NO-OP on screen.** Every class below is the pair those call
 * sites were already passing, so closing the vocabulary renders byte-identically. The restyle it
 * unblocks (`DASHBOARD-TEMPLATE-V2.md` §4.2b — gradient ground, white glyph, coloured glow) is a
 * separate change to the `tones` map in this file and nowhere else. Sequencing them apart is the
 * point: a refactor that changes nothing visually can be reviewed by diffing screenshots, and a
 * restyle that touches one map can be reviewed by reading it.
 *
 * ── THE TONE NAMES ARE `AppBadge`'S, EXACTLY ───────────────────────────────────────────────────
 * Seven names, same spelling, same order. A reader who knows what `tone="caution"` means on a badge
 * must not have to learn a second answer for a chip; and a page that puts a caution badge beside a
 * caution chip should be naming one idea once. `neutral` is the zero-value tone for a figure that
 * is real but unalarming — it is what `KpiHeroWidget` reaches for when the alert count is 0.
 */
export type ChipTone = "danger" | "caution" | "warning" | "success" | "info" | "brand" | "neutral";

withDefaults(
  defineProps<{
    icon: Icon;
    tone?: ChipTone;
    /**
     * `md` leads a hero KPI tile; `sm` trails a dense one and leads a card header.
     *
     * Both sizes were measured off the reference comps rather than chosen: the glyph is 50% of the
     * chip in every comp sampled, which is why 40/20 and 32/17 rather than a single icon size with
     * two boxes around it.
     */
    size?: "md" | "sm";
  }>(),
  { tone: "neutral", size: "md" },
);

/**
 * ⚠ The values are the INCUMBENT pairs, not a tidied version of them, and two of them look wrong
 * until you check what they replaced:
 *
 *   · `neutral` is `text-ink-muted bg-surface-muted` and NOT a neutral ramp step, because that is
 *     what `KpiHeroWidget` and `MaintenanceHomePage` were both passing for their zero case.
 *   · every other tone is `text-<hue>-600 bg-<hue>-50` — the 600/50 pairing, where `AppBadge` uses
 *     700/50. They differ because a badge carries TEXT at 12px and a chip carries a 20px glyph, so
 *     the badge needs the darker step to clear 4.5:1 and the chip does not. Aligning them here
 *     would have been a silent visual change inside a refactor that promises none.
 */
const tones: Record<ChipTone, string> = {
  danger: "text-danger-600 bg-danger-50",
  caution: "text-caution-600 bg-caution-50",
  warning: "text-warning-600 bg-warning-50",
  success: "text-success-600 bg-success-50",
  info: "text-info-600 bg-info-50",
  brand: "text-brand-600 bg-brand-50",
  neutral: "text-ink-muted bg-surface-muted",
};

/**
 * `rounded-surface` at both sizes rather than a radius per size, so the chip tracks the shape scale
 * instead of freezing at whatever looked right. Measured against the comps at 3×: their chip radius
 * is ~30% of the chip, which is 12px on 40 — `--shape-surface` exactly.
 */
const boxes: Record<"md" | "sm", string> = {
  md: "size-10 rounded-surface",
  sm: "size-9 rounded-surface",
};
const glyphs: Record<"md" | "sm", string> = { md: "size-6", sm: "size-5" };
</script>

<template>
  <span
    class="inline-flex shrink-0 items-center justify-center"
    :class="[boxes[size], tones[tone]]"
    aria-hidden="true"
  >
    <AppIcon :icon="icon" :class="glyphs[size]" />
  </span>
</template>
