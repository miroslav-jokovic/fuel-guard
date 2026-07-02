<script setup lang="ts">
import { ref } from "vue";
import { EllipsisVerticalIcon } from "@heroicons/vue/20/solid";
import { useFloating, offset, flip, shift, autoUpdate } from "@floating-ui/vue";

// A ⋮ actions menu. Put <button class="kebab-item"> children in the default slot.
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
      class="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
      aria-label="Actions"
      @click.stop="open = !open"
    >
      <EllipsisVerticalIcon class="size-5" />
    </button>
    <Teleport to="body">
      <template v-if="open">
        <div class="fixed inset-0 z-[9998]" @click.stop="open = false" />
        <div
          ref="panelRef"
          :style="floatingStyles"
          class="z-[9999] w-48 origin-top-right rounded-md bg-white py-1 shadow-lg ring-1 ring-black/5"
          @click="open = false"
        >
          <slot />
        </div>
      </template>
    </Teleport>
  </div>
</template>

<style scoped>
:slotted(.kebab-item) {
  display: block;
  width: 100%;
  padding: 0.375rem 0.75rem;
  text-align: left;
  font-size: 0.875rem;
  color: #374151;
}
:slotted(.kebab-item:hover) {
  background: #f9fafb;
}
:slotted(.kebab-item:disabled) {
  color: #9ca3af;
  cursor: not-allowed;
}
:slotted(.kebab-item-danger) {
  color: #dc2626;
}
</style>
