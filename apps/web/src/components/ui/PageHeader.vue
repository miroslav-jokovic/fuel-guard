<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { buildTrail } from "@/lib/breadcrumbs";
import BreadcrumbTrail from "@/components/ui/BreadcrumbTrail.vue";

const props = withDefaults(
  defineProps<{
    title?: string;
    description?: string;
    /**
     * A decorative plate behind the header (D-DR15, DESIGN-REFRESH-2026-09.md) — the dashboard's
     * greeting band. A URL under `public/hero/`, or undefined for the plain header every other
     * page uses.
     *
     * ── WHY THIS IS A PROP HERE AND NOT A SECOND COMPONENT ────────────────────────────────────
     * The comps draw breadcrumbs, an h1, a subtitle and right-aligned actions over the plate —
     * which is this component's exact anatomy, already built and already carrying G2's breadcrumb
     * trail. A `HeroBanner` beside it would have to re-derive the trail and re-declare the actions
     * slot, and would then be a second place where "what a page header is" is decided. The plate is
     * a background, so it is a property of the header rather than a different kind of header.
     *
     * ⚠ Decorative, so `alt=""` and `aria-hidden`: a screen reader announcing "a truck on a
     * highway" before the day's numbers is noise. The contrast of `--ink` over every shipped plate
     * is measured in the plan's §5 — all three clear 9.2:1 over the zone the text occupies — which
     * is why there is no scrim under the words.
     */
    hero?: string;
  }>(),
  {
    title: undefined,
    description: undefined,
    hero: undefined,
  },
);
const route = useRoute();
const router = useRouter();
const resolvedTitle = computed(() => props.title ?? (route.meta.title as string) ?? "Silvicom 360");

/**
 * The breadcrumb trail (G2, UI-GAPS-PLAN.md), walked from `meta.parent` by `lib/breadcrumbs.ts`.
 *
 * ⚠ `router.resolve` never returns null — since G1 an unknown path matches the catch-all — so the
 * "does this route exist" question is answered by checking the resolved name, not by a null test.
 * A dead parent must truncate the trail rather than produce a crumb labelled "Page not found".
 *
 * `BreadcrumbTrail` decides whether a trail is worth rendering; this only decides what the trail is.
 */
const trail = computed(() =>
  buildTrail(route.path, (path) => {
    const resolved = router.resolve(path);
    return resolved.name === "not-found" ? null : resolved.meta;
  }),
);
</script>

<template>
  <header
    :class="[
      'flex flex-col gap-4 sm:flex-row sm:justify-between',
      /*
       * The actions sit at the TOP of a hero band and at the BOTTOM of a plain header.
       * Measured at 1280px: bottom-aligned, they landed squarely on the truck's cab — the busiest,
       * highest-contrast corner of every plate — because the cab is bottom-right and so were they.
       * The sky is the quiet part of the frame, and the comps put the date range and Export up
       * there for the same reason. The plain header keeps `items-end`, where actions should line up
       * with the baseline of the title rather than float above it.
       */
      hero ? 'sm:items-start' : 'sm:items-end',
      hero
        ? 'relative isolate min-h-36 overflow-hidden rounded-surface bg-surface px-5 py-6 shadow-card ring-1 ring-edge-subtle sm:px-6'
        : 'border-b border-edge-subtle pb-5',
    ]"
  >
    <!--
      The plate is masked rather than overlaid with a gradient in a background colour. A gradient
      needs a COLOUR, which would have to be `--surface` and would then be wrong the moment this
      header sits on anything else; a mask fades the image to transparent and lets whatever is
      behind show through, so the band works on any surface without knowing which one it is on.
      It also means no colour token is involved, so nothing here can drift from the palette.
    -->
    <img
      v-if="hero"
      :src="hero"
      alt=""
      aria-hidden="true"
      class="pointer-events-none absolute inset-y-0 right-0 -z-10 h-full w-3/4 select-none object-cover
             [object-position:center_62%] [mask-image:linear-gradient(to_right,transparent,black_55%)]"
    />
    <div class="min-w-0">
      <BreadcrumbTrail :trail="trail" />
      <h1 class="text-2xl font-semibold tracking-tight text-ink">{{ resolvedTitle }}</h1>
      <p v-if="description || $slots.default" class="mt-1 max-w-3xl text-sm text-ink-tertiary">
        <slot>{{ description }}</slot>
      </p>
      <div v-if="$slots.freshness" class="mt-2 text-xs text-ink-tertiary">
        <slot name="freshness" />
      </div>
    </div>
    <div v-if="$slots.actions" class="flex shrink-0 flex-wrap items-center gap-2">
      <slot name="actions" />
    </div>
  </header>
</template>
