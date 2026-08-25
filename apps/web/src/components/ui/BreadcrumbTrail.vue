<script setup lang="ts">
/**
 * The breadcrumb trail's markup (G2, UI-GAPS-PLAN.md). Presentational: it takes a trail and renders
 * it, and knows nothing about the router.
 *
 * Split from `PageHeader` for two reasons. The walk and the rendering fail differently and are worth
 * testing apart — `lib/breadcrumbs.ts` answers "what is the chain", this answers "what does a chain
 * look like". And the design-system lab renders without a session or a route table, so a component
 * that needs neither is one the lab can actually show; a trail that only exists behind the auth wall
 * is a trail nobody reviews (D-DS13).
 */
import { computed } from "vue";
import { RouterLink } from "vue-router";
import { AppIcon } from "@fuelguard/ui";
import { ChevronRightIcon } from "@fuelguard/ui/icons";
import type { Crumb } from "@/lib/breadcrumbs";

const props = defineProps<{ trail: Crumb[] }>();

/**
 * One crumb is the current page, which the `<h1>` directly beneath already states. Rendering a
 * one-item "trail" would be chrome that says nothing.
 */
const show = computed(() => props.trail.length >= 2);
/** Everything except the current page — these are the links. */
const links = computed(() => props.trail.slice(0, -1));
const current = computed(() => props.trail[props.trail.length - 1]);
</script>

<template>
  <!--
    Below `sm` only the immediate parent shows (D-DS17). A three-level trail wraps on a phone, and a
    wrapped trail is a worse tap target than the back chevron in the header bar — which is precisely
    why that chevron survives this change rather than being retired as redundant.
  -->
  <nav v-if="show" aria-label="Breadcrumb" class="mb-1.5">
    <ol class="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-ink-tertiary">
      <li
        v-for="(crumb, i) in links"
        :key="crumb.to"
        class="flex items-center gap-x-1.5"
        :class="i < links.length - 1 ? 'hidden sm:flex' : ''"
      >
        <RouterLink
          :to="crumb.to"
          class="rounded-control transition-colors hover:text-ink-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          {{ crumb.label }}
        </RouterLink>
        <AppIcon :icon="ChevronRightIcon" class="size-3 shrink-0" aria-hidden="true" />
      </li>
      <li aria-current="page" class="truncate text-ink-secondary">{{ current!.label }}</li>
    </ol>
  </nav>
</template>
