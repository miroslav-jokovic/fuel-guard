<script setup lang="ts">
import { AppIcon } from "@silvicom/ui";
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
  <!-- Hover augments the contained trigger button; focus uses the same open/close path. -->
  <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions -->
  <div @mouseenter="openNow" @mouseleave="closeSoon" @focusin="openNow" @focusout="closeSoon">
    <button
      :id="`${sectionId}-trigger`"
      ref="triggerRef"
      type="button"
      class="sidebar-nav-item flex min-h-9 w-full items-center justify-center rounded-surface p-2"
      :class="sectionActive() ? 'sidebar-nav-active' : 'sidebar-nav-inactive'"
      :aria-label="group.label ?? undefined"
      :aria-expanded="open"
      :aria-controls="`${sectionId}-panel`"
      @click="toggleFromClick"
      @keydown.escape="open = false"
    >
      <AppIcon v-if="group.icon" :icon="group.icon" class="size-5 shrink-0" aria-hidden="true" />
    </button>

    <Teleport to="body">
      <!-- The floating region stays open while either pointer or keyboard focus is inside it. -->
      <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions -->
      <div
        v-if="open"
        :id="`${sectionId}-panel`"
        ref="panelRef"
        :style="floatingStyles"
        class="sidebar-glass-popover z-popover min-w-56 rounded-dialog p-1.5"
        role="group"
        :aria-labelledby="`${sectionId}-trigger`"
        @mouseenter="openNow"
        @mouseleave="closeSoon"
        @focusin="openNow"
        @focusout="closeSoon"
        @keydown.escape.stop.prevent="closeAndReturnFocus"
      >
        <div class="sidebar-glass-material" aria-hidden="true" />
        <div class="sidebar-glass-content">
          <p
            class="sidebar-section-label px-2.5 pb-1.5 pt-1.5 text-xs font-medium"
          >
            {{ group.label }}
          </p>
          <RouterLink
            v-for="item in group.items"
            :key="item.name"
            :to="item.to"
            class="sidebar-nav-item group flex min-h-9 items-center gap-x-2.5 rounded-surface px-2.5 py-1.5 text-sm font-medium leading-5"
            :class="isCurrent(item.to) ? 'sidebar-nav-active' : 'sidebar-nav-inactive'"
            :aria-current="isCurrent(item.to) ? 'page' : undefined"
            @click="open = false"
          >
            <AppIcon :icon="item.icon" class="size-5 shrink-0" aria-hidden="true" />
            {{ item.name }}
          </RouterLink>
        </div>
      </div>
    </Teleport>
  </div>
</template>
