<script setup lang="ts">
import { useToastStore, type Toast, type ToastVariant } from "@/stores/toast";
import {
  CheckCircleIcon,
  XCircleIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  XMarkIcon,
} from "@heroicons/vue/20/solid";
import type { FunctionalComponent } from "vue";

const toast = useToastStore();

interface VariantConfig {
  icon: FunctionalComponent;
  iconClass: string;
  borderClass: string;
  barClass: string;
  bgClass: string;
}

const CONFIG: Record<ToastVariant, VariantConfig> = {
  success: {
    icon: CheckCircleIcon,
    iconClass: "text-success-500",
    borderClass: "border-l-green-500",
    barClass: "bg-success-500",
    bgClass: "bg-surface",
  },
  error: {
    icon: XCircleIcon,
    iconClass: "text-danger-500",
    borderClass: "border-l-red-500",
    barClass: "bg-danger-500",
    bgClass: "bg-surface",
  },
  warning: {
    icon: ExclamationTriangleIcon,
    iconClass: "text-warning-500",
    borderClass: "border-l-amber-500",
    barClass: "bg-warning-500",
    bgClass: "bg-surface",
  },
  info: {
    icon: InformationCircleIcon,
    iconClass: "text-info-500",
    borderClass: "border-l-blue-500",
    barClass: "bg-info-500",
    bgClass: "bg-surface",
  },
};

function cfg(t: Toast): VariantConfig {
  return CONFIG[t.variant];
}
</script>

<template>
  <Teleport to="body">
    <div
      aria-live="assertive"
      class="pointer-events-none fixed inset-0 z-[10000] flex flex-col items-end justify-start gap-2 p-4 sm:p-6"
    >
      <TransitionGroup
        tag="div"
        class="flex w-full max-w-sm flex-col gap-2"
        enter-active-class="transform transition duration-300 ease-out"
        enter-from-class="translate-x-full opacity-0"
        enter-to-class="translate-x-0 opacity-100"
        leave-active-class="transform transition duration-200 ease-in"
        leave-from-class="translate-x-0 opacity-100"
        leave-to-class="translate-x-full opacity-0"
        move-class="transition-all duration-200"
      >
        <div
          v-for="t in toast.toasts"
          :key="t.id"
          class="pointer-events-auto relative w-full overflow-hidden rounded-lg border-l-4 shadow-lg ring-1 ring-edge"
          :class="[cfg(t).borderClass, cfg(t).bgClass]"
          role="alert"
        >
          <div class="flex items-start gap-3 px-4 py-3.5 pr-10">
            <component
              :is="cfg(t).icon"
              class="mt-0.5 size-5 shrink-0"
              :class="cfg(t).iconClass"
              aria-hidden="true"
            />
            <div class="min-w-0 flex-1">
              <p class="text-sm font-semibold text-ink">{{ t.title }}</p>
              <p v-if="t.message" class="mt-0.5 text-sm leading-snug text-ink-muted">{{ t.message }}</p>
            </div>
          </div>

          <button
            type="button"
            class="absolute right-2.5 top-2.5 rounded-md p-1 text-ink-subtle transition-colors hover:bg-surface-muted hover:text-ink-secondary focus:outline-none focus:ring-2 focus:ring-brand-600"
            :aria-label="`Dismiss ${t.variant} notification`"
            @click="toast.dismiss(t.id)"
          >
            <XMarkIcon class="size-4" aria-hidden="true" />
          </button>

          <div
            v-if="t.duration > 0"
            class="absolute bottom-0 left-0 h-0.5"
            :class="cfg(t).barClass"
            :style="`width: 100%; animation: fg-shrink ${t.duration}ms linear forwards`"
          />
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
@keyframes fg-shrink {
  from {
    width: 100%;
  }
  to {
    width: 0%;
  }
}
</style>
