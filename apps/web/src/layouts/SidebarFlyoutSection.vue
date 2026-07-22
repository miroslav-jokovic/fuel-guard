<script setup lang="ts">
import { ref, onBeforeUnmount } from "vue";
import { RouterLink } from "vue-router";
import { useFloating, offset, flip, shift, autoUpdate } from "@floating-ui/vue";
import type { NavGroup } from "@/lib/nav";

/**
 * One collapsed-rail section: a section icon that opens a flyout panel listing the section's pages
 * (Samsara-style). Opens on hover with a short close delay to bridge the rail↔panel gap, and toggles
 * on click for keyboard/touch. Active state highlights both the rail icon and the current page.
 */
const props = defineProps<{ group: NavGroup; isCurrent: (to: string) => boolean }>();

const open = ref(false);
const triggerRef = ref<HTMLElement | null>(null);
const panelRef = ref<HTMLElement | null>(null);
const { floatingStyles } = useFloating(triggerRef, panelRef, {
  placement: "right-start",
  middleware: [offset(8), flip(), shift({ padding: 8 })],
  whileElementsMounted: autoUpdate,
});

let closeTimer: ReturnType<typeof setTimeout> | null = null;
function cancelClose() {
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
}
function openNow() {
  cancelClose();
  open.value = true;
}
function closeSoon() {
  cancelClose();
  closeTimer = setTimeout(() => (open.value = false), 140);
}
onBeforeUnmount(cancelClose);

const sectionActive = () => props.group.items.some((i) => props.isCurrent(i.to));
</script>

<template>
  <div @mouseenter="openNow" @mouseleave="closeSoon">
    <button
      ref="triggerRef"
      type="button"
      class="flex w-full items-center justify-center rounded-lg p-2.5 transition-colors duration-150"
      :class="sectionActive() ? 'bg-brand-500/10 text-brand-300' : 'text-neutral-400 hover:bg-white/5 hover:text-neutral-200'"
      :aria-label="group.label ?? undefined"
      :aria-expanded="open"
      aria-haspopup="menu"
      @click="open = !open"
      @keydown.escape="open = false"
    >
      <component :is="group.icon" v-if="group.icon" class="size-5 shrink-0" aria-hidden="true" />
    </button>

    <Teleport to="body">
      <div
        v-if="open"
        ref="panelRef"
        :style="floatingStyles"
        class="z-[9999] min-w-52 rounded-lg border border-neutral-800/70 bg-neutral-900 p-2 shadow-xl ring-1 ring-black/20"
        role="menu"
        :aria-label="group.label ?? undefined"
        @mouseenter="openNow"
        @mouseleave="closeSoon"
      >
        <p class="px-2 pb-1.5 pt-1 text-xs font-semibold uppercase tracking-wider text-neutral-500">{{ group.label }}</p>
        <RouterLink
          v-for="item in group.items"
          :key="item.name"
          :to="item.to"
          role="menuitem"
          class="group flex items-center gap-x-3 rounded-md px-2.5 py-2 text-sm font-medium leading-6 transition-colors duration-150"
          :class="isCurrent(item.to) ? 'bg-brand-500/10 text-brand-300' : 'text-neutral-300 hover:bg-white/5 hover:text-white'"
          :aria-current="isCurrent(item.to) ? 'page' : undefined"
          @click="open = false"
        >
          <component :is="item.icon" class="size-5 shrink-0" aria-hidden="true" />
          {{ item.name }}
        </RouterLink>
      </div>
    </Teleport>
  </div>
</template>
