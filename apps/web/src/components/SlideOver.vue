<script setup lang="ts">
import { AppIcon } from "@silvicom/ui";
import { XMarkIcon } from "@silvicom/ui/icons";
import {
  Dialog,
  DialogDescription,
  DialogPanel,
  DialogTitle,
  TransitionRoot,
  TransitionChild,
} from "@headlessui/vue";
import { computed, useSlots } from "vue";
import { AppButton as BaseButton } from "@silvicom/ui";

const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    description?: string;
    /**
     * `xl` is for a drawer holding a WHOLE DOCUMENT rather than a form (added 2026-09-11 for the
     * application review, which the owner asked for as a full-width drawer from the applicant's
     * page). A §391.21 application is sixty answers and their corrections; at `max-w-lg` every
     * label-and-value row wraps, which is how a reviewer stops reading and starts scrolling.
     *
     * ⚠ It is a SIZE on the shared primitive rather than a bespoke panel beside it. A second
     * slide-over would be a second focus trap, a second transition and a second set of token
     * decisions, and this repo has already paid for that lesson once.
     */
    size?: "md" | "lg" | "xl";
  }>(),
  { description: undefined, size: "md" },
);
const emit = defineEmits<{ close: [] }>();
const slots = useSlots();

/**
 * ⚠ The panel also carries `min-w-0`, measured 2026-09-11. A flex item refuses to shrink below its
 * MIN-CONTENT width, and `break-words` does not reduce min-content (only `overflow-wrap: anywhere`
 * does) — so one long unbroken string inside a drawer (an email address, a licence number) held the
 * whole panel wider than the phone it was open on, and the right-hand 36px of every row sat off the
 * screen. `min-w-0` lets the panel take the width it is given, and the wrapping inside then folds
 * the long string.
 *
 * ⚠⚠ And nothing may go between `TransitionChild` and `DialogPanel` — not even an HTML comment.
 * `as="template"` requires exactly one child NODE, and a comment is a node: adding one there throws
 * "Passing props on template!" and takes every drawer in the app down with it. This note is here
 * rather than there for that reason.
 */
const WIDTHS = { md: "max-w-md", lg: "max-w-lg", xl: "max-w-4xl" } as const;
const panelWidth = computed(() => WIDTHS[props.size]);
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
        <div class="fixed inset-0 bg-scrim/60" />
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
              <DialogPanel class="pointer-events-auto w-screen min-w-0" :class="panelWidth">
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
