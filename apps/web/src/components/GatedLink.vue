<script setup lang="ts">
/**
 * A `RouterLink` that is a link only when its target opens for the reader, and plain text otherwise
 * (SP5, `SETTINGS-PERMISSIONS-PLAN.md` §4b, owner ruling 2026-09-30).
 *
 * For a link INSIDE a sentence or a table cell — "check Coverage to see…", a unit number in a row —
 * where hiding the element would leave a hole in the sentence or an empty cell. The words still say
 * what they said; they stop being a door the guard then shuts. A standalone link or button is hidden
 * with `v-if="opens(…)"` instead, because a button with nothing to press is noise.
 *
 * The attributes (the link's `class` above all) go to the link only: the fallback is the surrounding
 * text's own weight and colour, never link-blue text that does nothing when pressed. `plainClass`
 * is for the case where the link carried weight of its own (a card's heading), so the text keeps it.
 */
import { RouterLink, type RouteLocationRaw } from "vue-router";
import { useOpens } from "@/composables/useOpens";

defineOptions({ inheritAttrs: false });
defineProps<{ to: RouteLocationRaw; plainClass?: string | string[] }>();
const opens = useOpens();
</script>

<template>
  <RouterLink v-if="opens(to)" :to="to" v-bind="$attrs"><slot /></RouterLink>
  <span v-else :class="plainClass"><slot /></span>
</template>
