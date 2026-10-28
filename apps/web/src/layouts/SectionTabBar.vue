<script setup lang="ts">
import { ref } from "vue";
import { RouterLink } from "vue-router";
import { AppIcon } from "@silvicom/ui";
import type { NavGroup } from "@/lib/nav";
import { useBottomChrome } from "@/composables/bottomChrome";

/**
 * A phone-first section's doors along the bottom edge, below `md` (DESIGN-SYSTEM-CONTRACT.md §9 rule 7;
 * MAINTENANCE-SECTION-REDESIGN-PROPOSAL §4.5, Q-MX6).
 *
 * In the bay the shop's five doors are what a technician moves between all day, and the
 * hamburger puts each of them two taps and a scan of the whole product away. A tab row is one tap,
 * where the thumb already is. The rows are the sidebar's own (`phoneTabs`), so this file holds no
 * list and no permission: what a role cannot reach it never sees. The hamburger stays for the rest
 * of the product.
 *
 * It is the BASE layer of the bottom chrome: a page's verbs (`WalkActions`) stand on top of it, read
 * its height from `bottomChrome.ts`, and the Ask AI launcher and the page's bottom padding clear both.
 * The safe-area inset is padding here because this is the element on the edge.
 */
defineProps<{
  group: NavGroup;
  /** The path of the tab the page stands under (`phoneTabFor`), never a prefix test. */
  current: string | null;
}>();

const el = ref<HTMLElement | null>(null);
useBottomChrome(el, { base: true });
</script>

<template>
  <nav
    ref="el"
    :aria-label="group.label ?? 'Section'"
    class="tab-bar fixed inset-x-0 bottom-0 z-chrome border-t border-edge bg-surface md:hidden"
  >
    <ul class="flex">
      <li v-for="item in group.items" :key="item.to" class="min-w-0 flex-1">
        <RouterLink
          :to="item.to"
          :aria-current="item.to === current ? 'page' : undefined"
          class="flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 text-2xs font-medium focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring"
          :class="item.to === current ? 'text-brand-700' : 'text-ink-tertiary'"
        >
          <AppIcon :icon="item.icon" class="size-6 shrink-0" aria-hidden="true" />
          <!-- Wraps to two lines rather than truncating: "Annual inspections" is wider than a fifth of a 390 px phone. -->
          <span class="max-w-full text-center leading-tight text-balance">{{ item.name }}</span>
        </RouterLink>
      </li>
    </ul>
  </nav>
</template>

<style scoped>
.tab-bar {
  padding-bottom: env(safe-area-inset-bottom);
}
</style>
