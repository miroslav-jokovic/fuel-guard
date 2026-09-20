<script setup lang="ts">
import { computed } from "vue";
import { AppCard as BaseCard, AppIconChip, type ChipTone } from "@silvicom/ui";
import { type Icon } from "@silvicom/ui/icons";
import { RouterLink } from "vue-router";
import SparkLine from "@/components/SparkLine.vue";

/**
 * The one KPI tile (U3, D-UI2).
 *
 * ── WHY IT MOVED HERE ──────────────────────────────────────────────────────────────────────────
 * It was `features/dashboard/StatCard.vue`, and four other surfaces each re-approximated a subset of
 * it in place: the applicant board's four stage cards, the inquiry queue's three figures, screening
 * readiness's `<dl>` of blockers, and the qualification page's attention strip. `lint:boundaries`
 * only forbids feature→feature imports, so a page could always have imported it — but a component
 * five surfaces share is a `components/ui/` composite by the design contract's own §1.1b, not a
 * dashboard internal.
 *
 * ⚠ **Named `StatCard`, not `AppStatCard`** as `RECRUITING-UI-SURFACE-PLAN.md` U3 provisionally
 * called it. In this codebase the `App*` prefix means "exported from `@silvicom/ui`"; every
 * web-local composite beside this file (`PageHeader`, `DataWorkspace`, `FilterBar`, `DataTable`,
 * `FilterSelect`, `BaseModal`) carries no prefix. It cannot move into the shared package as it
 * stands anyway — `SparkLine` is web-local.
 *
 * ── TWO SIZES, BOTH ALREADY IN THE CONTRACT ───────────────────────────────────────────────────
 * The four hand-rolled variants disagreed about the value's size, and the contract turns out to
 * sanction TWO KPI anatomies rather than one, so this reconciles them instead of picking a winner:
 *
 *   • `size="hero"` — label `text-sm`, value `text-3xl font-semibold`. §2.2's size census lists
 *     `text-3xl` as "StatCard value; public marketing page h1", so the dashboard's hero row is the
 *     sanctioned exception, not a drift. Dashboard tiles keep rendering byte-identically.
 *   • `size="kpi"` (default) — label `text-xs uppercase tracking-wide`, value `text-2xl font-bold`.
 *     This is §2.4's prescriptive KPI row verbatim, and the qualification page's attention strip
 *     already matched it exactly, which is why that strip was taken as the anatomy that wins.
 *
 * Both are asserted by StatCard.test.ts's "renders the contract's KPI row by default" and "renders
 * the dashboard's hero anatomy under size=hero" — so a contract edit that moves either one fails
 * here rather than drifting silently, which is what four hand-rolled variants did.
 *
 * ── THE ICON IS OPTIONAL, DELIBERATELY ────────────────────────────────────────────────────────
 * Icon-less pages are the app-wide norm — icons live in the nav, this tile and `DataTable` rather
 * than in page bodies (D-UI6's ⚠). Making `icon` required would have forced a glyph onto the three
 * recruitment surfaces to satisfy a refactor, which is the opposite of what that finding said.
 */
type CardSize = "hero" | "kpi";

const props = withDefaults(
  defineProps<{
    label: string;
    /** Display value (already formatted). */
    value: string | number;
    /** Exact/long-form value for the hover title when `value` is compacted. */
    valueTitle?: string;
    sub?: string;
    icon?: Icon;
    /**
     * Which of the seven chip tones (D-DT17). Ignored with no icon.
     *
     * ⚠ It was an open string of Tailwind classes until 2026-09-20 — "text-success-600
     * bg-success-50" and 23 more like it, hand-written across 7 files. The colour therefore lived
     * at the call sites instead of in the system, which is why the chip could not be restyled
     * without editing two dozen of them. `AppIconChip` owns the map now; this is a NAME.
     */
    tone?: ChipTone;
    /**
     * Optional 30-point trend; nulls render as gaps.
     *
     * ⚠ `sparkColor` is effectively required alongside it. The dashboard version defaulted to
     * `viz.brand` from `lib/chartTheme`, and importing that here would drag the
     * chart layer into every page showing a tile with no chart on it. Both existing spark call
     * sites pass a colour; a caller that forgets one gets `currentColor`, which is legible rather
     * than invisible.
     */
    spark?: (number | null)[];
    sparkColor?: string;
    /**
     * Put the sparkline beside the value instead of under the whole tile (D-DR2, `size="hero"` only).
     *
     * ⚠ Opt-in rather than the hero default, and the reason is the caption. Comp (3)'s tile pairs an
     * inline spark with a SHORT caption — "Aug 17 – Sep 16", "97% of fuel measured" — and gives the
     * text column about half the tile. `FleetHeadlines` is the other hero caller and its captions are
     * deliberately sentences ("−47.7% vs June $123,456", D-FRUI3, written long because that page's
     * reader is a non-native speaker). Halving that column wraps them into ragged columns, which is
     * the thing D-FRUI3's own comment says it fixed. So the dashboard's glance tiles opt in and the
     * report's headlines do not, rather than one layout being forced to serve both.
     */
    sparkInline?: boolean;
    loading?: boolean;
    /** When set, the whole tile is a link — an interactive drill-down into the detail page. */
    to?: string;
    size?: CardSize;
    /**
     * Toggle mode. When this is a boolean the tile becomes a `<button>` carrying `aria-pressed`,
     * for a click-to-filter strip. `undefined` (the default) leaves it inert.
     *
     * ⚠ D-UI5: the pressed state is the ring and `aria-pressed`, and NOTHING else. The qualification
     * strip used to render a badge reading "filter"/"filtering" as well — `lib/badges.ts` is the
     * STATUS vocabulary, and a badge used as a toggle's label teaches the badge to mean two things.
     * Pinned by StatCard.test.ts's "carries its state in aria-pressed, not in a badge".
     *
     * ⚠ It MUST keep its explicit `undefined` default below. Vue casts an absent Boolean prop to
     * `false`, not `undefined`, so without that default every inert tile on the applicant board, the
     * inquiry queue and screening readiness rendered as `<button aria-pressed="false">` — announcing
     * three pages of plain figures to a screen reader as toggle buttons that do nothing. Declaring a
     * default is what disables the casting. Pinned by StatCard.test.ts's
     * "is inert markup with no `to` and no `pressed`".
     */
    pressed?: boolean;
    /** Dim the value when it is a zero worth showing but not worth alarming about. */
    muted?: boolean;
    /**
     * Semantic colour for `sub`, e.g. "text-danger-700" — for a period-over-period delta, where the
     * DIRECTION is the message and grey throws it away.
     *
     * ⚠ Deliberately a class rather than a `tone: "up" | "down"` enum: up is bad for spend and good for
     * MPG, so only the caller knows which way is which. An enum here would have to guess, and would be
     * wrong on half the tiles of the first page that used it.
     */
    subTone?: string;
  }>(),
  {
    // `withDefaults` makes every optional prop want an explicit default (vue/require-default-prop).
    // Spelling them out is not ceremony here: `pressed` MUST be one for the reason above, and a list
    // that names all of them is a list nobody has to wonder about.
    size: "kpi",
    pressed: undefined,
    valueTitle: undefined,
    sub: undefined,
    icon: undefined,
    tone: undefined,
    spark: undefined,
    sparkColor: undefined,
    sparkInline: false,
    subTone: undefined,
    to: undefined,
  },
);

const emit = defineEmits<{ toggle: [] }>();

const isToggle = computed(() => props.pressed !== undefined);
const hero = computed(() => props.size === "hero");

/** Inline only when there is a spark to put there, and only in the hero anatomy. */
const inlineSpark = computed(() => hero.value && props.sparkInline && Boolean(props.spark));

const labelClass = computed(() =>
  hero.value
    ? "truncate text-sm font-medium text-ink-muted"
    : "text-xs font-medium uppercase tracking-wide text-ink-muted",
);
/**
 * §2.4's KPI value, or §2.2's sanctioned StatCard `text-3xl`.
 *
 * ⚠ The hero value went `font-semibold` → `font-bold` at D-DR2. That is not a drift away from the
 * contract but a correction TOWARD it: §2.3 says in as many words that `font-bold` is reserved for
 * KPI numbers and headings are `font-semibold`, and this is a KPI number that had been wearing the
 * heading's weight. Comp (3) draws it bold too, so the comp and the contract agreed with each other
 * against the code.
 */
const valueClass = computed(() =>
  hero.value
    ? "mt-1.5 text-3xl font-bold tracking-tight"
    : "mt-1 text-2xl font-bold",
);
</script>

<template>
  <component
    :is="to ? RouterLink : 'div'"
    v-bind="to ? { to } : {}"
    :class="[
      'block rounded-dialog focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
      to ? 'group cursor-pointer' : '',
    ]"
  >
    <BaseCard
      :as="isToggle ? 'button' : 'div'"
      :padding="hero ? 'md' : 'sm'"
      :type="isToggle ? 'button' : undefined"
      :aria-pressed="isToggle ? pressed : undefined"
      :class="[
        'h-full',
        isToggle ? 'w-full text-left transition' : '',
        isToggle && pressed ? 'ring-2 ring-brand-600' : '',
        isToggle && !pressed ? 'hover:bg-surface-subtle' : '',
        to ? 'transition-colors duration-150 group-hover:bg-surface-subtle group-hover:ring-edge-control' : '',
      ]"
      @click="isToggle ? emit('toggle') : undefined"
    >
      <!--
        `size-10` and `gap-3` because the comp's chip measures ~40px.
      -->
      <div :class="hero ? 'flex items-start gap-3' : 'flex items-start justify-between gap-3'">
        <!-- D-DR2: the hero chip leads the tile from the left and is bigger; the KPI chip keeps its
             place on the right. Two elements rather than one with a reordering class, because the
             KPI anatomy is what fourteen surfaces render and the cheapest way to keep it
             byte-identical is to not touch its branch at all. Both sides are pinned by
             StatCard.test.ts's "leads with the icon chip in hero and trails with it in kpi", and the
             KPI classes themselves by "renders the contract's KPI row by default". -->
        <AppIconChip v-if="icon && hero" :icon="icon" :tone="tone" size="md" />
        <div class="min-w-0 flex-1">
          <!--
            ⚠ `flex-wrap` and `min-w-32`, and both are load-bearing (D-DR17).

            Shipped without them, the inline spark reserved `w-2/5` of the tile unconditionally, and
            at 1280px — where `xl:grid-cols-4` makes each tile 220px — that left the label 61px to
            render "Fleet avg MPG", which needs 91. It truncated to "Fleet a…". Measured, not
            guessed: pre-DR2 every label reported `scrollWidth - clientWidth === 0`, and after it
            "Fuel spend" was 7px short and "Fleet avg MPG" 30px.

            The fix is wrapping rather than a viewport breakpoint, because this is a CONTAINER
            question and a viewport rule gets it backwards: the very same tile is 410px wide in the
            two-up grid at 900px and 220px in the four-up at 1280px, so "inline above `xl`" would
            enable it exactly where it does not fit and disable it where it does. `min-w-32` is the
            floor the label needs; when the spark's 80px cannot also fit, it wraps onto its own line
            — which is the layout it had before going inline. The tile decides from its own width
            and no breakpoint has to know the grid it is sitting in.
          -->
          <div :class="inlineSpark ? 'flex flex-wrap items-center gap-x-4 gap-y-3' : ''">
            <div :class="inlineSpark ? 'min-w-32 flex-1' : 'min-w-0'">
          <p :class="labelClass">{{ label }}</p>
          <template v-if="loading">
            <div class="mt-2.5 h-8 w-24 animate-pulse rounded-control bg-surface-muted" />
            <div class="mt-2 h-3 w-16 animate-pulse rounded-control bg-surface-muted" />
          </template>
          <template v-else>
            <p :class="[valueClass, muted ? 'text-ink-muted' : 'text-ink']" :title="valueTitle">
              {{ value }}
            </p>
            <!-- `#sub` lets a caller compose the line from parts in different tones — a change
                 against last month in red beside a year-to-date figure in grey (D-FRUI3) — where
                 the `sub` string can only wear one `subTone`. Same slot in the anatomy, so a tile
                 with a composed line and a tile with a plain one still line up. -->
            <p v-if="sub || $slots.sub" :class="['mt-0.5 flex items-center gap-1 text-xs', subTone ?? 'text-ink-tertiary']">
              <slot name="sub">{{ sub }}</slot>
              <span v-if="to" class="text-brand-500 opacity-0 transition group-hover:opacity-100">&rarr;</span>
            </p>
            <!-- A delta belongs under the value and above the caption: the caption is what the
                 delta is measured AGAINST ("vs previous 30 days"), so reading downward gives the
                 figure, its movement, then its anchor. D-DR4 keeps it a slot rather than a prop —
                 only the caller knows whether up is good news. -->
            <div v-if="$slots.delta" class="mt-2">
              <slot name="delta" />
            </div>
          </template>
            </div>
            <!-- Vertically centred against the value, not the tile: the caption sits below and a
                 spark centred on the whole tile floats visibly low beside it. -->
            <div v-if="inlineSpark && !loading" class="w-20 grow">
              <SparkLine :points="spark!" :color="sparkColor ?? 'currentColor'" />
            </div>
          </div>
        </div>
        <AppIconChip v-if="icon && !hero" :icon="icon" :tone="tone" size="sm" />
      </div>
      <div v-if="spark && !loading && !inlineSpark" class="mt-3">
        <SparkLine :points="spark" :color="sparkColor ?? 'currentColor'" />
      </div>
    </BaseCard>
  </component>
</template>
