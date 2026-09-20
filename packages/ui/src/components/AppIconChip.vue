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
     * ⚠ The sizes are the INCUMBENT ones and they are not the comps': measured in a browser
     * 2026-09-20, `md` renders 40px with a 24px glyph and `sm` 36px with a 20px glyph — a glyph at
     * 60% and 56% of its chip. The comps sample at 50% (40/20 and 32/17), and the version of this
     * comment before this one asserted those figures as if they were what the code does. They were
     * never measured against it. Resizing is a real visual change at every call site, so it is
     * recorded as an open question in `DASHBOARD-TEMPLATE-V2.md` rather than smuggled into a
     * restyle that only touches colour.
     */
    size?: "md" | "sm";
  }>(),
  { tone: "neutral", size: "md" },
);

/**
 * ⚠ **This is the restyle the vocabulary above was closed for (D-DT17 §4.2b), and it is a change
 * of style rather than a tuning of the old one.** What was here until 2026-09-20 was the incumbent
 * `text-<hue>-600 bg-<hue>-50` pair — a pale tint with a coloured glyph, the `dashboard 3`
 * treatment. This is the `card 4` one: a solid two-stop gradient down one hue's ramp, a white
 * glyph on it, a 28%-white top edge where the light catches a solid object, and the chip's own
 * colour cast on the card beneath it.
 *
 * Everything colour lives in `packages/tokens/src/roles.*.json` as `--chip-<tone>-from|to` and
 * `--elevation-chip-<tone>`, because the two stops are NOT the same ramp steps in both schemes and
 * a utility cannot say that — light is 500→700, dark is 600→300, measured per tone. The
 * `control-well` comment in that file carries the numbers; the short version is that the dark ramps
 * turn over between 300 and 400, so the light pair renders as a pale chip in dark and the white
 * glyph drops to 1.78:1 on it.
 *
 * ⚠ Both stops come from ONE hue's ramp, never across two. A green→blue chip invents a colour
 * relationship the token system does not have, and that is how a palette stops meaning anything.
 */
const tones: Record<ChipTone, string> = {
  danger: "bg-linear-140 from-chip-danger-from to-chip-danger-to shadow-chip-danger",
  caution: "bg-linear-140 from-chip-caution-from to-chip-caution-to shadow-chip-caution",
  warning: "bg-linear-140 from-chip-warning-from to-chip-warning-to shadow-chip-warning",
  success: "bg-linear-140 from-chip-success-from to-chip-success-to shadow-chip-success",
  info: "bg-linear-140 from-chip-info-from to-chip-info-to shadow-chip-info",
  brand: "bg-linear-140 from-chip-brand-from to-chip-brand-to shadow-chip-brand",
  neutral: "bg-linear-140 from-chip-neutral-from to-chip-neutral-to shadow-chip-neutral",
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
    class="inline-flex shrink-0 items-center justify-center text-chip-glyph"
    :class="[boxes[size], tones[tone]]"
    aria-hidden="true"
  >
    <!--
      Stroke 2.2, not the 1.5 every other AppIcon takes (D-DT17 §4.2b). A white stroke on a
      saturated ground loses roughly a third of its apparent weight to the light around it: the
      same glyph that reads as bold in `ramp-700` on `ramp-100` reads as spidery in white on
      `ramp-500`. The number is the prototype's, measured on a 24 grid at 3×.
    -->
    <AppIcon :icon="icon" :class="glyphs[size]" :stroke-width="2.2" />
  </span>
</template>
