import { defineStore } from "pinia";
import { ref } from "vue";

export type ToastVariant = "success" | "error" | "warning" | "info";

/**
 * One action, optional (INVENTORY-PLAN.md I5's undo toast).
 *
 * ⚠ ONE, and never two. A toast is a transient thing a person glances at; two choices in it is a
 * dialog that vanishes, and the count screen it was added for is used with one thumb at arm's
 * length. The action runs and the toast dismisses — a caller that needs the toast to survive its
 * own action wants a dialog instead.
 */
export interface ToastAction {
  label: string;
  onAction: () => void | Promise<void>;
}

export interface Toast {
  id: string;
  variant: ToastVariant;
  title: string;
  message?: string;
  duration: number;
  action?: ToastAction;
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

  /**
   * `options` replaced a bare `duration` argument when the undo toast landed. It is an object rather
   * than a fifth positional so the next thing a toast needs does not become a sixth — the same
   * reasoning `DataTable`'s column object records.
   */
  function push(
    variant: ToastVariant,
    title: string,
    message?: string,
    options?: number | { duration?: number; action?: ToastAction },
  ): string {
    const opts = typeof options === "number" ? { duration: options } : (options ?? {});
    const duration = opts.duration;
    const id =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`;
    const ms = duration ?? DEFAULT_DURATIONS[variant];

    if (toasts.value.length >= MAX_VISIBLE) toasts.value.shift();
    toasts.value.push({ id, variant, title, message, duration: ms, action: opts.action });

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
