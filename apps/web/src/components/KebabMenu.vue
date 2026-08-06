<script setup lang="ts">
import { AppIcon } from "@fuelguard/ui";
import {
  EllipsisVerticalIcon,
} from "@fuelguard/ui/icons";
import { computed, ref } from "vue";
import { useFloating, offset, flip, shift, autoUpdate, type Placement } from "@floating-ui/vue";

// The one dropdown menu. Put <button class="kebab-item"> children in the default slot.
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
          : 'rounded-md p-1 text-ink-subtle hover:bg-surface-muted hover:text-ink-secondary focus:ring-2 focus:ring-brand-600 focus:outline-none',
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
        <div class="fixed inset-0 z-[9998]" @click.stop="open = false" />
        <div
          ref="panelRef"
          :style="floatingStyles"
          :class="tone === 'sidebar' ? 'sidebar-glass-popover rounded-2xl' : 'rounded-md bg-surface shadow-lg ring-1 ring-edge'"
          class="z-[9999] w-48 origin-top-right py-1"
          @click="open = false"
        >
          <slot />
        </div>
      </template>
    </Teleport>
  </div>
</template>
