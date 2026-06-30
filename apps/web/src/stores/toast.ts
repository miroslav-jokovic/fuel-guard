import { defineStore } from "pinia";
import { ref } from "vue";

export type ToastVariant = "success" | "error" | "warning" | "info";

export interface Toast {
  id: string;
  variant: ToastVariant;
  title: string;
  message?: string;
  duration: number;
}

const DEFAULT_DURATIONS: Record<ToastVariant, number> = {
  success: 4000,
  info: 4000,
  warning: 5000,
  error: 6000,
};

const MAX_VISIBLE = 5;

export const useToastStore = defineStore("toast", () => {
  const toasts = ref<Toast[]>([]);

  function push(variant: ToastVariant, title: string, message?: string, duration?: number): string {
    const id =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`;
    const ms = duration ?? DEFAULT_DURATIONS[variant];

    if (toasts.value.length >= MAX_VISIBLE) toasts.value.shift();
    toasts.value.push({ id, variant, title, message, duration: ms });

    if (ms > 0) setTimeout(() => dismiss(id), ms);
    return id;
  }

  function dismiss(id: string) {
    const idx = toasts.value.findIndex((t) => t.id === id);
    if (idx !== -1) toasts.value.splice(idx, 1);
  }

  function clear() {
    toasts.value = [];
  }

  const success = (title: string, message?: string) => push("success", title, message);
  const error = (title: string, message?: string) => push("error", title, message);
  const warning = (title: string, message?: string) => push("warning", title, message);
  const info = (title: string, message?: string) => push("info", title, message);

  return { toasts, push, dismiss, clear, success, error, warning, info };
});
