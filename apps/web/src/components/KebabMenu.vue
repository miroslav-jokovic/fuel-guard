<script setup lang="ts">
import { ref } from "vue";
import { EllipsisVerticalIcon } from "@heroicons/vue/20/solid";
import { useFloating, offset, flip, shift, autoUpdate } from "@floating-ui/vue";

// The one dropdown menu. Put <button class="kebab-item"> children in the default slot.
// Default trigger is the ⋮ icon (table action columns); pass a #trigger slot for
// custom triggers (toolbar dropdowns) — panel styling stays identical either way.
const open = ref(false);

const triggerRef = ref<HTMLElement | null>(null);
const panelRef = ref<HTMLElement | null>(null);

const { floatingStyles } = useFloating(triggerRef, panelRef, {
  placement: "bottom-end",
  middleware: [offset(4), flip(), shift({ padding: 8 })],
  whileElementsMounted: autoUpdate,
});
</script>

<template>
  <div class="inline-block text-left">
    <button
      ref="triggerRef"
      type="button"
      :class="$slots.trigger ? '' : 'rounded-md p-1 text-ink-subtle hover:bg-surface-muted hover:text-ink-secondary focus:ring-2 focus:ring-brand-600 focus:outline-none'"
      :aria-label="$slots.trigger ? undefined : 'Actions'"
      :aria-expanded="open"
      aria-haspopup="menu"
      @click.stop="open = !open"
      @keydown.escape="open = false"
    >
      <slot name="trigger"><EllipsisVerticalIcon class="size-5" /></slot>
    </button>
    <Teleport to="body">
      <template v-if="open">
        <div class="fixed inset-0 z-[9998]" @click.stop="open = false" />
        <div
          ref="panelRef"
          :style="floatingStyles"
          class="z-[9999] w-48 origin-top-right rounded-md bg-surface py-1 shadow-lg ring-1 ring-edge"
          @click="open = false"
        >
          <slot />
        </div>
      </template>
    </Teleport>
  </div>
</template>

