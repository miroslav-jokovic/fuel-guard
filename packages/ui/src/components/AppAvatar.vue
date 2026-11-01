<script setup lang="ts">
import { computed } from "vue";
import { identityClass } from "../identity";

/**
 * AppAvatar — the initial-in-a-circle used to stand in for a person (G4, UI-GAPS-PLAN.md).
 *
 * An extraction, not a new capability. `SidebarProfileMenu.vue` had written this twice in one file
 * against a `.sidebar-avatar` rule in `apps/web/src/style.css`, and that was the only avatar in the
 * product. G4 gave it one home and moved the styling off the stylesheet and into the component
 * (D-DS9's direction). It deliberately adds avatars to no driver, applicant or audit surface —
 * whether a photo-less coloured circle helps anyone scan a table is a product question nobody has
 * asked.
 *
 * ⚠ The glyph is `aria-hidden` and the component contributes NO accessible name, which contradicts
 * what UI-GAPS-PLAN.md §5 specified. The plan was written before its only consumer was read: both
 * call sites sit inside a `KebabMenu` whose trigger already announces "Account menu for
 * <email>", so a name here would make a screen reader say the address twice. An avatar is a
 * decoration for a label that is already present; if a future caller renders one standalone, that
 * caller is the one that knows what it should be called, and it can add the prop then (D-DS18).
 */
const props = withDefaults(
  defineProps<{
    /** The person this stands for — an email today, a name if a caller ever has one. */
    label: string | null | undefined;
    size?: "xs" | "sm" | "md";
    /**
     * A stable key for the person — their user id — from which the circle's colour is derived
     * (D-CHATUI22, `identity.ts`). Absent, the circle is the neutral grey it has always been, which
     * is what the sidebar's account menu keeps: one person, nobody to tell them apart from.
     */
    identity?: string | null;
  }>(),
  { size: "md", identity: null },
);

/**
 * First letter of the first word, plus the first letter of the last word when there is more than
 * one. No special-casing of "@": an email has no spaces, so it yields a single letter by the same
 * rule that gives "Marcus Reyes" two. Non-letters are dropped first, so a label that starts with a
 * quote or a bracket does not render punctuation in a circle.
 */
const initials = computed(() => {
  const words = (props.label ?? "")
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
  if (!words.length) return "?";
  const first = words[0]![0]!;
  const last = words.length > 1 ? words[words.length - 1]![0]! : "";
  return (first + last).toUpperCase();
});

// `xs` (24px, 10px initials) is a chip's: a person picked in the chat people picker (2026-11-01).
const SIZES = { xs: "size-6 text-2xs", sm: "size-7 text-xs", md: "size-8 text-xs" } as const;
const NEUTRAL = "bg-surface-muted text-ink ring-1 ring-inset ring-edge";
// A coloured circle carries no ring: the tint is its edge, and a grey ring over it reads as a stain.
const tone = computed(() => identityClass(props.identity) ?? NEUTRAL);
</script>

<template>
  <span
    :class="[
      'flex shrink-0 items-center justify-center rounded-full font-semibold',
      tone,
      SIZES[props.size],
    ]"
    aria-hidden="true"
    >{{ initials }}</span
  >
</template>
