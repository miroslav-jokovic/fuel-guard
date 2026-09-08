<script setup lang="ts">
/**
 * One numbered-feeling section of a legal document: a heading and its prose.
 *
 * It exists so the three pages hold CONTENT and not class strings. The body sets the text size and
 * tone once and every paragraph inside inherits both, which is what keeps the pages inside the
 * seven-size type scale without each `<p>` having to remember it (D-DS6). Lists carry their own
 * `list-disc space-y-1.5 pl-5` at the few places they appear: an arbitrary variant here
 * (`[&_ul]:list-disc`) would style them from a distance, and a reader editing the copy would have no
 * way to see why a list is indented.
 *
 * `id` is on the heading rather than the section so that a link to `#retention` lands with the
 * heading at the top of the viewport instead of one line above it.
 */
defineProps<{ title: string; id: string }>();
</script>

<template>
  <section class="space-y-3">
    <h2 :id="id" class="text-lg font-semibold text-ink">{{ title }}</h2>
    <div class="space-y-3 text-sm leading-relaxed text-ink-secondary">
      <slot />
    </div>
  </section>
</template>
