<script setup lang="ts">
import { AppIcon } from "@silvicom/ui";
import {
  EllipsisVerticalIcon,
} from "@silvicom/ui/icons";
import { computed, ref } from "vue";
import { useFloating, offset, flip, shift, autoUpdate, type Placement } from "@floating-ui/vue";

// The one dropdown menu. Put <BaseButton class="kebab-item"> children in the default slot.
// ⚠ NOT a raw <button>, which this line said until 2026-08-21 (U5): `lint:ui-adoption` counts
// raw <button> in pages/ and features/ as a failure, so the instruction was un-followable at
// every call site that matters. All nine call sites already pass BaseButton.
// Default trigger is the ⋮ icon (table action columns); pass a #trigger slot for
// custom triggers (toolbar dropdowns) — panel styling stays identical either way.
const open = ref(false);

const props = withDefaults(
  defineProps<{
    block?: boolean;
    placement?: Placement;
    triggerLabel?: string;
    tone?: "default" | "sidebar";
  }>(),
  {
    block: false,
    placement: "bottom-end",
    triggerLabel: undefined,
    tone: "default",
  },
);

const triggerRef = ref<HTMLElement | null>(null);
const panelRef = ref<HTMLElement | null>(null);

const { floatingStyles } = useFloating(triggerRef, panelRef, {
  placement: computed(() => props.placement),
  middleware: [offset(4), flip(), shift({ padding: 8 })],
  whileElementsMounted: autoUpdate,
});
</script>

<template>
  <div :class="block ? 'block w-full' : 'inline-block'" class="text-left">
    <button
      ref="triggerRef"
      type="button"
      :class="[
        $slots.trigger
          ? 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/80'
          : 'rounded-control p-1 text-ink-tertiary hover:bg-surface-muted hover:text-ink-secondary focus:ring-2 focus:ring-focus-ring focus:outline-none',
        block ? 'w-full' : '',
      ]"
      :aria-label="triggerLabel ?? ($slots.trigger ? undefined : 'Actions')"
      :aria-expanded="open"
      aria-haspopup="menu"
      @click.stop="open = !open"
      @keydown.escape="open = false"
    >
      <slot name="trigger"><AppIcon :icon="EllipsisVerticalIcon" class="size-5" /></slot>
    </button>
    <Teleport to="body">
      <template v-if="open">
        <button type="button" class="fixed inset-0 z-scrim" aria-label="Close actions menu" @click.stop="open = false" />
        <!-- The panel delegates selection close to its keyboard-accessible menu-item buttons. -->
        <!-- eslint-disable-next-line vuejs-accessibility/click-events-have-key-events, vuejs-accessibility/no-static-element-interactions -->
        <div
          ref="panelRef"
          :style="floatingStyles"
          :class="
            tone === 'sidebar'
              ? 'sidebar-glass-popover rounded-dialog'
              : 'rounded-control bg-surface shadow-overlay'
          "
          class="z-popover w-48 origin-top-right py-1"
          @click="open = false"
        >
          <div v-if="tone === 'sidebar'" class="sidebar-glass-material" aria-hidden="true" />
          <div :class="tone === 'sidebar' ? 'sidebar-glass-content' : undefined">
            <slot />
          </div>
        </div>
      </template>
    </Teleport>
  </div>
</template>
