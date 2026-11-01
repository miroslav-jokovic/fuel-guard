<script setup lang="ts">
import { computed } from "vue";
import { AppIcon } from "@silvicom/ui";
import { ChevronDownIcon } from "@silvicom/ui/icons";
import type { NavGroup } from "@/lib/nav";
import SidebarNavItem from "./SidebarNavItem.vue";

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
 *
 * Since the sidebar redesign (D-SB3) sections start CLOSED unless they hold the current page, so the
 * header is what most readers see of most sections. It therefore wears the section's own icon — the
 * one the collapsed rail already shows — so the open sidebar and the rail read as one menu, and
 * a reader who learnt the rail's icons finds the same ones here.
 */
const props = defineProps<{
  group: NavGroup;
  open: boolean;
  isCurrent: (to: string) => boolean;
  touch?: boolean;
  isPinned: (key: string) => boolean;
  pinFull: boolean;
}>();

const emit = defineEmits<{ toggle: []; togglePin: [key: string]; navigate: [] }>();

/** From the group KEY: stable across a relabel, and always a valid fragment. */
const listId = computed(() => `sidebar-section-${props.group.key}`);

/** A badge on a collapsed section is the only thing still reporting from inside it. */
const hiddenBadgeTotal = computed(() =>
  props.group.items.reduce((sum, item) => sum + (typeof item.badge === "number" ? item.badge : 0), 0),
);
</script>

<template>
  <li class="mt-1">
    <button
      type="button"
      class="sidebar-section-toggle group flex w-full items-center gap-x-2 rounded-control px-2.5 text-left text-xs font-medium"
      :class="touch ? 'min-h-11' : 'min-h-8'"
      :aria-expanded="open"
      :aria-controls="listId"
      @click="emit('toggle')"
    >
      <AppIcon v-if="group.icon" :icon="group.icon" class="size-4 shrink-0" aria-hidden="true" />
      <span class="flex-1">{{ group.label }}</span>
      <span
        v-if="!open && hiddenBadgeTotal > 0"
        class="sidebar-nav-badge rounded-full px-1.5 py-0.5 text-2xs font-semibold"
        :aria-label="`${hiddenBadgeTotal} in ${group.label}`"
        >{{ hiddenBadgeTotal }}</span
      >
      <!--
        D-DR13: the chevron trails the label rather than leading it (owner's ruling, 2026-09-16).
        It led the label until then, which put the disclosure control in the same column as the nav
        items' ICONS one row below — two different meanings sharing a column, so the eye read the
        chevron as a section "icon" rather than as a control. On the right it sits in its own column
        with nothing to be confused with, which is also what every comp draws. (D-SB3 put the
        section's real icon in that leading column, which makes the ruling's reason stronger.)

        The badge stays BEFORE it: when a section is collapsed the badge is the only thing still
        reporting from inside it, and a count that jumps outboard of the chevron when the section
        closes is a moving target.
      -->
      <AppIcon
        :icon="ChevronDownIcon"
        class="size-3.5 shrink-0 transition-transform"
        :class="open ? '' : '-rotate-90'"
        aria-hidden="true"
      />
    </button>
  </li>

  <li v-show="open" :id="listId">
    <ul class="flex flex-col gap-y-0.5 pb-1">
      <SidebarNavItem
        v-for="item in group.items"
        :key="item.key"
        :item="item"
        :current="isCurrent(item.to)"
        :touch="touch"
        :pinned="isPinned(item.key)"
        :pin-full="pinFull"
        @toggle-pin="emit('togglePin', item.key)"
        @navigate="emit('navigate')"
      />
    </ul>
  </li>
</template>
