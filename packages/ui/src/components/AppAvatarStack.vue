<script setup lang="ts">
import { computed } from "vue";
import AppAvatar from "./AppAvatar.vue";

/**
 * A few people as overlapping circles, then "+N" (D-CHATUI24, office chat header, 2026-11-01).
 *
 * The header of a group or a channel said only its name; who was in it took a menu. Every work chat
 * reviewed shows the faces instead. The stack is decorative, like `AppAvatar` — the caller labels it
 * (`label`), because only the caller knows whether it is "4 people" or "members of # General".
 *
 * Each circle carries a 2px ring of the surface it sits on, so the overlap reads as a cut-out, not
 * as two colours bleeding into each other. `ring-surface` is the stage's ground; a caller on another
 * ground can pass `ringClass`.
 *
 * `sm` (28px) and a 4px overlap: at 24px with 6px the next circle cut the second initial of every one but
 * the last ("MI" read "M:"), seen in the built header 2026-11-01; 28px with 6px still cut it. Now the
 * initials clear the next circle's ring.
 */
const props = withDefaults(
  defineProps<{
    people: ReadonlyArray<{ id: string; label: string | null | undefined }>;
    /** How many people the group really has, when `people` is only the first few. */
    total?: number;
    max?: number;
    size?: "xs" | "sm";
    label: string;
    ringClass?: string;
  }>(),
  { total: undefined, max: 3, size: "sm", ringClass: "ring-surface" },
);

const shown = computed(() => props.people.slice(0, props.max));
const more = computed(() => Math.max((props.total ?? props.people.length) - shown.value.length, 0));
const SIZES = { xs: "size-6 text-2xs", sm: "size-7 text-xs" } as const;
</script>

<template>
  <span class="flex items-center" role="img" :aria-label="label">
    <AppAvatar
      v-for="(p, i) in shown"
      :key="p.id"
      :label="p.label"
      :identity="p.id"
      :size="size"
      class="ring-2"
      :class="[ringClass, i > 0 ? '-ml-1' : '']"
    />
    <span
      v-if="more > 0"
      class="-ml-1 flex shrink-0 items-center justify-center rounded-full bg-surface-muted font-semibold text-ink-secondary ring-2"
      :class="[SIZES[size], ringClass]"
      aria-hidden="true"
    >+{{ more }}</span>
  </span>
</template>
