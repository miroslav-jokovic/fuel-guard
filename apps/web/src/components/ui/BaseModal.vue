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

/**
 * The one CENTRED dialog (DQF execution plan B5) — added deliberately as a second sanctioned
 * overlay beside `SlideOver`, not a competitor to it. The boundary: a SlideOver keeps the list
 * visible beside a form; a BaseModal takes the middle of the screen for content that needs WIDTH —
 * a scanned medical card at 28rem is not legible, and widening SlideOver would change every
 * existing drawer. Same Dialog, same scrim, same 300ms transitions, same header/body/footer
 * anatomy; only the panel geometry differs.
 *
 * `printable` puts `.print-target` on the panel: the @media print rules in style.css then print
 * exactly this panel's content via `window.print()` — the only cross-origin-safe way to print a
 * signed-URL image (an iframe.contentWindow.print() on another origin is blocked, and a popup is
 * popup-blocked; see B6).
 */
const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    description?: string;
    size?: "md" | "lg" | "xl";
    printable?: boolean;
  }>(),
  { description: undefined, size: "md", printable: false },
);
const emit = defineEmits<{ close: [] }>();
const slots = useSlots();

const panelWidth = computed(() =>
  props.size === "xl" ? "max-w-4xl" : props.size === "lg" ? "max-w-lg" : "max-w-md",
);
</script>

<template>
  <TransitionRoot as="template" :show="open">
    <Dialog class="relative z-50" @close="emit('close')">
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

      <div class="fixed inset-0 overflow-y-auto">
        <div class="flex min-h-full items-center justify-center p-4">
          <TransitionChild
            as="template"
            enter="ease-in-out duration-300"
            enter-from="opacity-0 scale-95"
            enter-to="opacity-100 scale-100"
            leave="ease-in-out duration-300"
            leave-from="opacity-100 scale-100"
            leave-to="opacity-0 scale-95"
          >
            <DialogPanel
              class="w-full max-h-[90vh] rounded-dialog bg-surface shadow-dialog ring-1 ring-edge"
              :class="[panelWidth, printable ? 'print-target' : '']"
            >
              <div class="flex max-h-[90vh] flex-col">
                <div
                  class="flex items-start justify-between gap-4 border-b border-edge px-4 py-4 sm:px-6"
                >
                  <div class="min-w-0">
                    <DialogTitle class="text-base font-semibold text-ink">{{ title }}</DialogTitle>
                    <DialogDescription v-if="description" class="mt-1 text-sm text-ink-muted">
                      {{ description }}
                    </DialogDescription>
                  </div>
                  <BaseButton
                    variant="ghost"
                    size="sm"
                    class="-mr-2 shrink-0 px-2 text-ink-tertiary"
                    aria-label="Close dialog"
                    @click="emit('close')"
                  >
                    <AppIcon :icon="XMarkIcon" class="size-5" aria-hidden="true" />
                  </BaseButton>
                </div>
                <div class="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
                  <slot />
                </div>
                <div v-if="slots.footer" class="border-t border-edge bg-surface px-4 py-4 sm:px-6">
                  <slot name="footer" />
                </div>
              </div>
            </DialogPanel>
          </TransitionChild>
        </div>
      </div>
    </Dialog>
  </TransitionRoot>
</template>
