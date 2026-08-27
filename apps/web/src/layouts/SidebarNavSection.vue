<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import { AppIcon } from "@silvicom/ui";
import { ChevronDownIcon } from "@silvicom/ui/icons";
import type { NavGroup } from "@/lib/nav";

/**
 * One collapsible sidebar section.
 *
 * The section label used to be a `<li>` — decoration with no behaviour. It is a `<button>` now,
 * because it does something, and the accessibility follows from that rather than being bolted on:
 * `aria-expanded` says which way it is, `aria-controls` points at the list it owns, and the list
 * carries a matching id. A screen reader gets a real disclosure; a keyboard gets Enter and Space
 * without any handler of ours.
 *
 * The chevron rotates rather than swapping glyph, so the transition is one property and reduced
 * motion flattens it along with everything else (D-DS9a).
 */
const props = defineProps<{
  group: NavGroup;
  open: boolean;
  isCurrent: (to: string) => boolean;
  navLinkClass: (to: string) => (string | Record<string, boolean>)[];
}>();

const emit = defineEmits<{ toggle: [] }>();

/** Ids must survive a label with spaces — "Fuel cards" would otherwise be an invalid fragment. */
const listId = computed(() => `sidebar-section-${(props.group.label ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`);

/** A badge on a collapsed section is the only thing still reporting from inside it. */
const hiddenBadgeTotal = computed(() =>
  props.group.items.reduce((sum, item) => sum + (typeof item.badge === "number" ? item.badge : 0), 0),
);
</script>

<template>
  <li class="mt-4">
    <button
      type="button"
      class="sidebar-section-toggle group flex w-full items-center gap-x-1.5 rounded-control px-2.5 py-1.5 text-left text-xs font-medium"
      :aria-expanded="open"
      :aria-controls="listId"
      @click="emit('toggle')"
    >
      <AppIcon
        :icon="ChevronDownIcon"
        class="size-3.5 shrink-0 transition-transform"
        :class="open ? '' : '-rotate-90'"
        aria-hidden="true"
      />
      <span class="flex-1">{{ group.label }}</span>
      <span
        v-if="!open && hiddenBadgeTotal > 0"
        class="sidebar-nav-badge rounded-full px-1.5 py-0.5 text-2xs font-semibold"
        :aria-label="`${hiddenBadgeTotal} in ${group.label}`"
        >{{ hiddenBadgeTotal }}</span
      >
    </button>
  </li>

  <li v-show="open" :id="listId">
    <ul class="flex flex-col gap-y-0.5">
      <li v-for="item in group.items" :key="item.name">
        <RouterLink
          :to="item.to"
          :class="navLinkClass(item.to)"
          :aria-current="isCurrent(item.to) ? 'page' : undefined"
        >
          <AppIcon :icon="item.icon" class="size-5 shrink-0" aria-hidden="true" />
          <span class="flex-1">{{ item.name }}</span>
          <span
            v-if="item.badge"
            class="sidebar-nav-badge rounded-full px-1.5 py-0.5 text-xs font-semibold"
            >{{ item.badge }}</span
          >
        </RouterLink>
      </li>
    </ul>
  </li>
</template>
