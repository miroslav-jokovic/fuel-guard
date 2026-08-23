<script setup lang="ts">
import { AppIcon } from "@fuelguard/ui";
import { XMarkIcon } from "@fuelguard/ui/icons";
import {
  Dialog,
  DialogDescription,
  DialogPanel,
  DialogTitle,
  TransitionRoot,
  TransitionChild,
} from "@headlessui/vue";
import { computed, useSlots } from "vue";
import { AppButton as BaseButton } from "@fuelguard/ui";

const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    description?: string;
    size?: "md" | "lg";
  }>(),
  { description: undefined, size: "md" },
);
const emit = defineEmits<{ close: [] }>();
const slots = useSlots();

const panelWidth = computed(() => (props.size === "lg" ? "max-w-lg" : "max-w-md"));
</script>

<template>
  <TransitionRoot as="template" :show="open">
    <Dialog class="relative z-dialog" @close="emit('close')">
      <TransitionChild
        as="template"
        enter="ease-in-out duration-300"
        enter-from="opacity-0"
        enter-to="opacity-100"
        leave="ease-in-out duration-300"
        leave-from="opacity-100"
        leave-to="opacity-0"
      >
        <div class="fixed inset-0 bg-neutral-900/60" />
      </TransitionChild>

      <div class="fixed inset-0 overflow-hidden">
        <div class="absolute inset-0 overflow-hidden">
          <div class="pointer-events-none fixed inset-y-0 right-0 flex max-w-full pl-10">
            <TransitionChild
              as="template"
              enter="transform transition ease-in-out duration-300"
              enter-from="translate-x-full"
              enter-to="translate-x-0"
              leave="transform transition ease-in-out duration-300"
              leave-from="translate-x-0"
              leave-to="translate-x-full"
            >
              <DialogPanel class="pointer-events-auto w-screen" :class="panelWidth">
                <div class="flex h-full flex-col bg-surface shadow-dialog">
                  <div
                    class="flex items-start justify-between gap-4 border-b border-edge px-4 py-4 sm:px-6"
                  >
                    <div class="min-w-0">
                      <DialogTitle class="text-base font-semibold text-ink">{{
                        title
                      }}</DialogTitle>
                      <DialogDescription v-if="description" class="mt-1 text-sm text-ink-muted">
                        {{ description }}
                      </DialogDescription>
                    </div>
                    <BaseButton
                      variant="ghost"
                      size="sm"
                      class="-mr-2 shrink-0 px-2 text-ink-tertiary"
                      aria-label="Close drawer"
                      @click="emit('close')"
                    >
                      <AppIcon :icon="XMarkIcon" class="size-5" aria-hidden="true" />
                    </BaseButton>
                  </div>
                  <div class="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
                    <slot />
                  </div>
                  <div
                    v-if="slots.footer"
                    class="border-t border-edge bg-surface px-4 py-4 sm:px-6"
                  >
                    <slot name="footer" />
                  </div>
                </div>
              </DialogPanel>
            </TransitionChild>
          </div>
        </div>
      </div>
    </Dialog>
  </TransitionRoot>
</template>
