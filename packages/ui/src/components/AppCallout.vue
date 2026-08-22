<script setup lang="ts">
import { computed } from "vue";
import AppIcon from "./AppIcon.vue";
import type { Icon } from "../icons.js";

/**
 * The one inline notice (UI plan U4, D-UI4).
 *
 * ── WHY IT EXISTS ─────────────────────────────────────────────────────────────────────────────
 * 28 files hand-rolled `bg-<role>-50 … ring-1 ring-<role>-100` before this existed. Every one of
 * them passed `lint:tokens` — the colours are real token roles — because that gate reads COLOUR and
 * this was never a colour problem. It was the same structure written 28 times, drifting in padding,
 * radius, text tone and whether the copy was a `<span>` or a `<p>`.
 *
 * ⚠ **This is NOT for mutation feedback.** `apps/web/CLAUDE.md` is explicit: the result of a save is
 * a toast, never an inline banner. A callout says something that is TRUE ABOUT THE PAGE while you
 * look at it — "no qualification file yet", "SMS is off until 10DLC completes" — and stays there
 * after any action finishes. If it would disappear on success, it is a toast.
 *
 * ── THE TONE MAP IS STATIC ON PURPOSE ─────────────────────────────────────────────────────────
 * ⚠ `bg-${tone}-50` cannot be built by interpolation: Tailwind scans source text for literal class
 * names, so a computed one is never emitted and the callout renders transparent — a failure that
 * looks like a styling nit and is actually an invisible warning. Every combination is spelled out.
 */
export type CalloutTone = "brand" | "info" | "caution" | "warning" | "danger" | "success";

const TONE: Record<CalloutTone, string> = {
  brand: "bg-brand-50 ring-brand-100 text-brand-800",
  info: "bg-info-50 ring-info-100 text-info-800",
  caution: "bg-caution-50 ring-caution-100 text-caution-800",
  warning: "bg-warning-50 ring-warning-100 text-warning-800",
  danger: "bg-danger-50 ring-danger-100 text-danger-800",
  success: "bg-success-50 ring-success-100 text-success-800",
};

const props = withDefaults(
  defineProps<{ tone?: CalloutTone; icon?: Icon }>(),
  { tone: "info", icon: undefined },
);

const toneClass = computed(() => TONE[props.tone]);
</script>

<template>
  <div
    class="flex flex-wrap items-center gap-2 rounded-surface px-4 py-2.5 text-sm font-medium ring-1"
    :class="toneClass"
  >
    <AppIcon v-if="icon" :icon="icon" class="size-4 shrink-0" aria-hidden="true" />
    <span class="min-w-0"><slot /></span>
    <!-- Actions sit hard right so a one-line callout reads as statement-then-remedy. -->
    <span v-if="$slots.actions" class="ml-auto flex shrink-0 items-center gap-2"><slot name="actions" /></span>
  </div>
</template>
