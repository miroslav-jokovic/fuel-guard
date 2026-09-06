<script setup lang="ts">
import { computed } from "vue";
import { AppIcon, AppCard as BaseCard } from "@silvicom/ui";
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
    /** Tailwind classes for the icon chip, e.g. "text-success-600 bg-success-50". Ignored with no icon. */
    tone?: string;
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
    subTone: undefined,
    to: undefined,
  },
);

const emit = defineEmits<{ toggle: [] }>();

const isToggle = computed(() => props.pressed !== undefined);
const hero = computed(() => props.size === "hero");

const labelClass = computed(() =>
  hero.value
    ? "truncate text-sm font-medium text-ink-muted"
    : "text-xs font-medium uppercase tracking-wide text-ink-muted",
);
/** §2.4's KPI value, or §2.2's sanctioned StatCard `text-3xl`. */
const valueClass = computed(() =>
  hero.value
    ? "mt-1.5 text-3xl font-semibold tracking-tight"
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
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
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
          </template>
        </div>
        <span
          v-if="icon"
          :class="['inline-flex size-9 shrink-0 items-center justify-center rounded-surface', tone]"
          aria-hidden="true"
        >
          <AppIcon :icon="icon" class="size-5" />
        </span>
      </div>
      <div v-if="spark && !loading" class="mt-3">
        <SparkLine :points="spark" :color="sparkColor ?? 'currentColor'" />
      </div>
    </BaseCard>
  </component>
</template>
