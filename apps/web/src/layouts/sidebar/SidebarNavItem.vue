<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import { AppIcon } from "@silvicom/ui";
import { PinIcon, UnpinIcon } from "@silvicom/ui/icons";
import type { NavItem } from "@/lib/nav";

/**
 * One sidebar row — the link, its count, and the pin control (SIDEBAR-REDESIGN-PLAN.md D-SB2, D-SB6).
 *
 * It exists because the shell drew this row three times (drawer, expanded, the section list) and
 * each copy had its own classes; the redesign would have had to change all three identically. One
 * row, rendered wherever a row is.
 *
 * ⚠ The pin is a SIBLING of the link, not inside it: a button inside an `<a>` is invalid HTML and a
 * screen reader announces the pair as one control. It sits over the row's right edge and appears on
 * hover or focus; while it shows, the badge steps aside, because the two share that corner and a
 * count under a pin is unreadable. The count is still in the link's accessible name.
 */
const props = defineProps<{
  item: NavItem;
  current: boolean;
  /** A coarse pointer or a narrow window: the 44 px floor rather than the desk's 36 (D-SB6). */
  touch?: boolean;
  pinned: boolean;
  /** Six pins already: offering a seventh would do nothing, so the control says why instead. */
  pinFull: boolean;
}>();

const emit = defineEmits<{ togglePin: []; navigate: [] }>();

const pinLabel = computed(() =>
  props.pinned
    ? `Unpin ${props.item.name}`
    : props.pinFull
      ? `Pinned is full — unpin a page to pin ${props.item.name}`
      : `Pin ${props.item.name} to the top`,
);
</script>

<template>
  <li class="group/row relative">
    <RouterLink
      :to="item.to"
      :class="[
        current ? 'sidebar-nav-active' : 'sidebar-nav-inactive',
        touch ? 'min-h-11' : 'min-h-9',
        'sidebar-nav-item flex items-center gap-x-2.5 rounded-control py-1.5 pl-2.5 pr-9 text-sm font-medium leading-5',
      ]"
      :aria-current="current ? 'page' : undefined"
      @click="emit('navigate')"
    >
      <AppIcon :icon="item.icon" class="size-5 shrink-0" aria-hidden="true" />
      <span class="min-w-0 flex-1 truncate">{{ item.name }}</span>
      <span
        v-if="item.badge"
        class="sidebar-nav-badge absolute right-2 rounded-full px-1.5 py-0.5 text-xs font-semibold group-focus-within/row:invisible group-hover/row:invisible"
        >{{ item.badge }}</span
      >
    </RouterLink>
    <button
      type="button"
      class="sidebar-pin absolute inset-y-0 right-1 my-auto flex size-7 items-center justify-center rounded-control opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100"
      :class="{ 'sidebar-pin-on': pinned }"
      :aria-label="pinLabel"
      :aria-pressed="pinned"
      :title="pinLabel"
      :aria-disabled="!pinned && pinFull ? 'true' : undefined"
      @click="!pinned && pinFull ? undefined : emit('togglePin')"
    >
      <AppIcon :icon="pinned ? UnpinIcon : PinIcon" class="size-4" aria-hidden="true" />
    </button>
  </li>
</template>
