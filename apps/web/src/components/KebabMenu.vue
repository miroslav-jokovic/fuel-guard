<script setup lang="ts">
import { AppIcon, useTouchTargets } from "@silvicom/ui";
import {
  EllipsisVerticalIcon,
  type Icon,
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
    /**
     * `wide` (18rem) is for items that carry a line of description under their label
     * (`KebabMenuItem`'s `description`) — office chat's New menu, 2026-11-01. The 12rem default
     * wraps a description into three lines.
     */
    width?: "default" | "wide";
    /**
     * An icon trigger in place of the ⋮ (office chat's New and emoji buttons, 2026-11-01). It is drawn
     * with `AppIconButton`'s own size and variant classes rather than BY `AppIconButton`, because the
     * trigger is already this menu's <button> and a button inside a button is invalid markup.
     * `triggerLabel` is its name and its tooltip.
     */
    icon?: Icon;
    iconVariant?: "ghost" | "secondary";
  }>(),
  {
    icon: undefined,
    iconVariant: "ghost",
    width: "default",
    block: false,
    placement: "bottom-end",
    triggerLabel: undefined,
    tone: "default",
  },
);

// AppIconButton's ghost and secondary looks, less the size (set by touch above).
const ICON_TRIGGER = {
  ghost: "inline-flex items-center justify-center rounded-control text-ink-tertiary hover:bg-surface-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring",
  secondary: "inline-flex items-center justify-center rounded-control bg-surface text-ink-secondary ring-1 ring-inset ring-edge-control hover:bg-surface-subtle hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring",
} as const;

const triggerRef = ref<HTMLElement | null>(null);
const panelRef = ref<HTMLElement | null>(null);

const { floatingStyles } = useFloating(triggerRef, panelRef, {
  placement: computed(() => props.placement),
  middleware: [offset(4), flip(), shift({ padding: 8 })],
  whileElementsMounted: autoUpdate,
});

/** A 48 px trigger under the touch floor (contract §9 rule 1); M3's pass measured it at 28. */
const touch = useTouchTargets();
</script>

<template>
  <div :class="block ? 'block w-full' : 'inline-block'" class="text-left">
    <button
      ref="triggerRef"
      type="button"
      :class="[
        $slots.trigger
          ? 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/80'
          : icon
            ? ICON_TRIGGER[iconVariant]
            : 'rounded-control p-1 text-ink-tertiary hover:bg-surface-muted hover:text-ink-secondary focus:ring-2 focus:ring-focus-ring focus:outline-none',
        !$slots.trigger && touch ? 'inline-flex size-12 items-center justify-center' : '',
        icon && !touch ? (iconVariant === 'secondary' ? 'size-9' : 'size-8') : '',
        block ? 'w-full' : '',
      ]"
      :aria-label="triggerLabel ?? ($slots.trigger ? undefined : 'Actions')"
      :title="icon ? triggerLabel : undefined"
      :aria-expanded="open"
      aria-haspopup="menu"
      @click.stop="open = !open"
      @keydown.escape="open = false"
    >
      <slot name="trigger"><AppIcon :icon="icon ?? EllipsisVerticalIcon" :class="icon && iconVariant === 'ghost' ? 'size-4' : 'size-5'" /></slot>
    </button>
    <Teleport to="body">
      <template v-if="open">
        <button type="button" class="fixed inset-0 z-scrim" aria-label="Close actions menu" @click.stop="open = false" />
        <!-- The panel delegates selection close to its keyboard-accessible menu-item buttons. -->
        <!-- eslint-disable-next-line vuejs-accessibility/click-events-have-key-events, vuejs-accessibility/no-static-element-interactions -->
        <div
          ref="panelRef"
          :style="floatingStyles"
          :class="[
            tone === 'sidebar' ? 'sidebar-glass-popover rounded-dialog' : 'rounded-control bg-surface shadow-overlay',
            width === 'wide' ? 'w-72' : 'w-48',
          ]"
          class="z-popover origin-top-right py-1"
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
