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
import { AppIcon } from "@silvicom/ui";
import { ChevronRightIcon } from "@silvicom/ui/icons";
import type { Crumb } from "@/lib/breadcrumbs";

const props = withDefaults(
  defineProps<{
    trail: Crumb[];
    /**
     * Whether a crumb's page opens for the reader (SP5, plan §4b). A crumb whose target the guard
     * would refuse renders as TEXT: the trail still says where the page sits, it just stops offering
     * a door that bounces to the dashboard — a hazmat load's parent is Loads, which is `dispatch`
     * while the load itself is `hazmat`. A PROP, not a `useOpens()` here, for the reason in the header: this component
     * knows nothing about the router or the session, which is what lets the lab render it. Absent,
     * every crumb links, which is what the lab wants.
     */
    opens?: (to: string) => boolean;
  }>(),
  { opens: () => true },
);

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
          v-if="opens(crumb.to)"
          :to="crumb.to"
          class="rounded-control transition-colors hover:text-ink-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          {{ crumb.label }}
        </RouterLink>
        <span v-else>{{ crumb.label }}</span>
        <AppIcon :icon="ChevronRightIcon" class="size-3 shrink-0" aria-hidden="true" />
      </li>
      <li aria-current="page" class="truncate text-ink-secondary">{{ current!.label }}</li>
    </ol>
  </nav>
</template>
