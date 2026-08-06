<script setup lang="ts">
import { AppIcon } from "@fuelguard/ui";
import { computed, ref, onBeforeUnmount } from "vue";
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
const sectionId = computed(() => `sidebar-${(props.group.label ?? "section").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`);
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
function toggleFromClick(event: { detail: number }) {
  // Pointer entry already opens the panel before click fires. Keep that click open; keyboard
  // activation (detail === 0) remains a true toggle and announces the changed expanded state.
  open.value = event.detail === 0 ? !open.value : true;
}
function closeAndReturnFocus() {
  open.value = false;
  triggerRef.value?.focus();
}
onBeforeUnmount(cancelClose);

const sectionActive = () => props.group.items.some((i) => props.isCurrent(i.to));
</script>

<template>
  <div @mouseenter="openNow" @mouseleave="closeSoon">
    <button
      :id="`${sectionId}-trigger`"
      ref="triggerRef"
      type="button"
      class="flex w-full items-center justify-center rounded-xl p-2.5 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/80 motion-reduce:transition-none"
      :class="sectionActive() ? 'bg-white/[0.12] text-white ring-1 ring-inset ring-white/[0.16] shadow-sm' : 'text-neutral-300 hover:bg-white/[0.085] hover:text-white'"
      :aria-label="group.label ?? undefined"
      :aria-expanded="open"
      :aria-controls="`${sectionId}-panel`"
      @click="toggleFromClick"
      @keydown.escape="open = false"
    >
      <AppIcon v-if="group.icon" :icon="group.icon" class="size-5 shrink-0" aria-hidden="true" />
    </button>

    <Teleport to="body">
      <div
        v-if="open"
        :id="`${sectionId}-panel`"
        ref="panelRef"
        :style="floatingStyles"
        class="sidebar-glass-popover z-[9999] min-w-56 rounded-2xl p-2"
        role="group"
        :aria-labelledby="`${sectionId}-trigger`"
        @mouseenter="openNow"
        @mouseleave="closeSoon"
        @keydown.escape.stop.prevent="closeAndReturnFocus"
      >
        <p class="px-2 pb-1.5 pt-1 text-xs font-semibold uppercase tracking-wider text-neutral-500">{{ group.label }}</p>
        <RouterLink
          v-for="item in group.items"
          :key="item.name"
          :to="item.to"
          class="group flex items-center gap-x-3 rounded-lg px-2.5 py-2 text-sm font-medium leading-6 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/80 motion-reduce:transition-none"
          :class="isCurrent(item.to) ? 'bg-white/[0.12] text-white ring-1 ring-inset ring-white/[0.16]' : 'text-neutral-300 hover:bg-white/[0.085] hover:text-white'"
          :aria-current="isCurrent(item.to) ? 'page' : undefined"
          @click="open = false"
        >
          <AppIcon :icon="item.icon" class="size-5 shrink-0" aria-hidden="true" />
          {{ item.name }}
        </RouterLink>
      </div>
    </Teleport>
  </div>
</template>
