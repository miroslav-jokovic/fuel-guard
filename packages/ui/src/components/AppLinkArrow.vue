<script setup lang="ts">
/**
 * AppLinkArrow — the arrow at the end of a link that takes you somewhere (2026-11-04).
 *
 * Until now every such link typed its own glyph after the label: `Fix →`, `Open the full file →`,
 * `Open in a new tab ↗`, and `StatCard` an `&rarr;` entity. A typed arrow is a character of the
 * body font, so it took the label's weight, sat on the text baseline rather than its middle, and
 * looked thin and dated beside the HugeIcons glyphs everywhere else on the page. This draws the
 * icon instead, in one place, so every link carries the same arrow.
 *
 * `external` picks the diagonal arrow for a link that leaves the app (a new tab); the straight
 * arrow means "a page in this app". The arrow is decorative — the label already says where the
 * link goes — so it is hidden from assistive technology.
 *
 * The parent link carries `group` (and `inline-flex items-center gap-1`, or the arrow sits on the
 * text baseline); on hover the arrow moves 2 px in its own direction, unless the reader asked for
 * reduced motion.
 */
import AppIcon from "./AppIcon.vue";
import { ArrowRightIcon, ArrowUpRightIcon } from "../icons";

defineProps<{ external?: boolean }>();
</script>

<template>
  <AppIcon
    :icon="external ? ArrowUpRightIcon : ArrowRightIcon"
    :stroke-width="2"
    :class="[
      'size-3.5 shrink-0 transition-transform duration-150',
      external
        ? 'motion-safe:group-hover:-translate-y-0.5 motion-safe:group-hover:translate-x-0.5'
        : 'motion-safe:group-hover:translate-x-0.5',
    ]"
    aria-hidden="true"
    data-link-arrow
  />
</template>
