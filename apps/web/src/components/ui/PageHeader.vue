<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { buildTrail } from "@/lib/breadcrumbs";
import { hasHeroPlate } from "@/lib/layout";
import BreadcrumbTrail from "@/components/ui/BreadcrumbTrail.vue";

const props = withDefaults(
  defineProps<{
    title?: string;
    description?: string;
  }>(),
  {
    title: undefined,
    description: undefined,
  },
);
const route = useRoute();
const router = useRouter();
const resolvedTitle = computed(() => props.title ?? (route.meta.title as string) ?? "Silvicom 360");

/**
 * Is this header standing on the page backdrop (D-DT18)?
 *
 * ⚠ Until 2026-09-20 the plate was this component's own `hero` prop, drawn as an `<img>` inside a
 * card band. D-DT15 took the card away and D-DT18 took the photograph away as well — a plate that
 * lives inside the header has to END where the header ends, and the only tool left for the ending
 * was a fade dissolving it into empty canvas a few pixels above the tab strip. That is a picture
 * that ran out. `AppShell` draws it as a page layer now, and all this header needs to know is that
 * something is behind it: a greeting standing on a photograph takes no bottom rule and no card.
 */
const onBackdrop = computed(() => hasHeroPlate(route));

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
      onBackdrop ? 'sm:items-start' : 'sm:items-end',
      /*
       * ⚠ No surface, no ring, no elevation, and no bottom rule (D-DT15/D-DT18). A card made a
       * photograph look like a widget and put a border around the one element on the page that is
       * not a control; the rule below it would now be a line drawn across the middle of a
       * photograph. The height is the band's own — 136px, the prototype's — so the greeting sits
       * level with the subject rather than above it.
       */
      onBackdrop ? 'relative min-h-34 justify-center py-2' : 'border-b border-edge-subtle pb-5',
    ]"
  >
    <div class="min-w-0">
      <BreadcrumbTrail :trail="trail" />
      <!--
        One step up on a plate (D-DT22): a 24px greeting beside a photograph ~100px tall read as a
        caption to the picture rather than the page's title — the image out-weighed the words it was
        there to frame. The plain header keeps 2xl, where it is the largest thing on the page anyway.
      -->
      <h1
        :class="[
          'font-semibold tracking-tight text-ink',
          onBackdrop ? 'text-3xl text-balance' : 'text-2xl',
        ]"
      >
        {{ resolvedTitle }}
      </h1>
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
