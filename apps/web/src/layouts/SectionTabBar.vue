<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { onKeyStroke } from "@vueuse/core";
import { AppIcon } from "@silvicom/ui";
import { ChevronRightIcon, EllipsisHorizontalCircleIcon } from "@silvicom/ui/icons";
import type { NavGroup } from "@/lib/nav";
import { tabRowDoors } from "@/lib/phoneFirst";
import { useBottomChrome } from "@/composables/bottomChrome";

/**
 * A phone-first section's doors along the bottom edge, below `md` (DESIGN-SYSTEM-CONTRACT.md §9 rule 7;
 * MAINTENANCE-SECTION-REDESIGN-PROPOSAL §4.5, Q-MX6).
 *
 * In the bay the shop's doors are what a technician moves between all day, and the hamburger puts
 * each of them two taps and a scan of the whole product away. A tab row is one tap, where the thumb
 * already is. The rows are the sidebar's own (`phoneTabs`), so this file holds no list and no
 * permission: what a role cannot reach it never sees. The hamburger stays for the rest of the product.
 *
 * ── AT MOST FIVE DOORS (2026-11-27) ───────────────────────────────────────────────────────────
 * Follow-ups made the row six, and on the owner's iPhone every door shrank to 65 px: two labels broke
 * onto two lines, their icons rose out of line with the other four, and the row read as crowded.
 * Past five the first four stand and the rest open from More (`tabRowDoors`) — the pattern both
 * platforms ship. More lights up when the page stands under one of its rows, so the row always says
 * where you are. Every icon sits at the same height whatever its label does: the column is laid out
 * from the top, and a label that still needs two lines hangs below its icon instead of lifting it.
 *
 * It is the BASE layer of the bottom chrome: a page's verbs (`WalkActions`) stand on top of it, read
 * its height from `bottomChrome.ts`, and the Ask AI launcher and the page's bottom padding clear both.
 * The safe-area inset is padding here because this is the element on the edge — and it only has a
 * value because `index.html` asks for `viewport-fit=cover` (INSTALLED-APP-PLAN Q-IA6).
 */
const props = defineProps<{
  group: NavGroup;
  /** The path of the tab the page stands under (`phoneTabFor`), never a prefix test. */
  current: string | null;
}>();

const el = ref<HTMLElement | null>(null);
useBottomChrome(el, { base: true });

const split = computed(() => tabRowDoors(props.group.items));
const moreIsCurrent = computed(() => split.value.more.some((item) => item.to === props.current));

const moreOpen = ref(false);
const sheet = ref<HTMLElement | null>(null);
const route = useRoute();
watch(() => route.fullPath, () => (moreOpen.value = false));
onKeyStroke("Escape", () => (moreOpen.value = false));
watch(moreOpen, async (open) => {
  if (!open) return;
  await nextTick();
  sheet.value?.querySelector<HTMLElement>("a")?.focus();
});
</script>

<template>
  <nav
    ref="el"
    :aria-label="group.label ?? 'Section'"
    class="tab-bar fixed inset-x-0 bottom-0 z-chrome border-t border-edge bg-surface md:hidden"
  >
    <ul class="flex">
      <li v-for="item in split.doors" :key="item.to" class="min-w-0 flex-1">
        <RouterLink
          :to="item.to"
          :aria-current="item.to === current ? 'page' : undefined"
          class="tab-door min-h-14"
          :class="item.to === current ? 'text-selected-strong' : 'text-ink-tertiary'"
        >
          <span class="tab-pill" :class="{ 'bg-selected-surface': item.to === current }">
            <AppIcon :icon="item.icon" class="size-6 shrink-0" aria-hidden="true" />
          </span>
          <span class="tab-label" :class="item.to === current ? 'font-semibold' : 'font-medium'">{{ item.name }}</span>
        </RouterLink>
      </li>
      <li v-if="split.more.length" class="min-w-0 flex-1">
        <button
          type="button"
          class="tab-door min-h-14 w-full"
          :class="moreIsCurrent || moreOpen ? 'text-selected-strong' : 'text-ink-tertiary'"
          :aria-current="moreIsCurrent ? 'page' : undefined"
          :aria-expanded="moreOpen"
          aria-haspopup="dialog"
          @click="moreOpen = !moreOpen"
        >
          <span class="tab-pill" :class="{ 'bg-selected-surface': moreIsCurrent }">
            <AppIcon :icon="EllipsisHorizontalCircleIcon" class="size-6 shrink-0" aria-hidden="true" />
          </span>
          <span class="tab-label" :class="moreIsCurrent ? 'font-semibold' : 'font-medium'">More</span>
        </button>
      </li>
    </ul>
  </nav>

  <Teleport to="body">
    <template v-if="moreOpen">
      <button type="button" class="fixed inset-0 z-scrim bg-scrim/60 md:hidden" aria-label="Close" @click="moreOpen = false" />
      <div
        ref="sheet"
        role="dialog"
        aria-modal="true"
        :aria-label="`More in ${group.label ?? 'this section'}`"
        class="more-sheet fixed inset-x-0 bottom-0 z-popover rounded-t-dialog bg-surface shadow-overlay md:hidden"
      >
        <div class="mx-auto mt-2 h-1 w-10 rounded-full bg-edge" aria-hidden="true" />
        <p class="px-5 pt-3 pb-1 text-xs font-medium text-ink-tertiary">{{ group.label ?? "More" }}</p>
        <ul class="px-2 pb-2">
          <li v-for="item in split.more" :key="item.to">
            <RouterLink
              :to="item.to"
              :aria-current="item.to === current ? 'page' : undefined"
              class="flex min-h-14 items-center gap-3 rounded-control px-3 text-base focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring"
              :class="item.to === current ? 'bg-selected-surface font-semibold text-selected-strong' : 'font-medium text-ink hover:bg-surface-muted'"
              @click="moreOpen = false"
            >
              <AppIcon :icon="item.icon" class="size-6 shrink-0" aria-hidden="true" />
              <span class="min-w-0 flex-1 truncate">{{ item.name }}</span>
              <AppIcon :icon="ChevronRightIcon" class="size-4 shrink-0 text-ink-tertiary" aria-hidden="true" />
            </RouterLink>
          </li>
        </ul>
      </div>
    </template>
  </Teleport>
</template>

<style scoped>
.tab-bar {
  padding-bottom: env(safe-area-inset-bottom);
  padding-left: env(safe-area-inset-left);
  padding-right: env(safe-area-inset-right);
}
/*
 * Laid out from the top, not centred: a centred column lifts its icon when its label takes two lines,
 * which is what put the screenshot's icons at two heights. Every label box holds two lines, so the
 * row's height and every icon's position are the same whatever the words are.
 */
.tab-door {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  gap: 0.125rem;
  padding: 0.375rem 0.125rem 0.25rem;
  -webkit-tap-highlight-color: transparent;
}
.tab-door:focus-visible {
  outline: 2px solid var(--color-focus-ring);
  outline-offset: -2px;
}
.tab-pill {
  display: flex;
  height: 2rem;
  width: 3.5rem;
  align-items: center;
  justify-content: center;
  border-radius: 9999px;
  transition: background-color 150ms ease;
}
.tab-label {
  display: -webkit-box;
  max-width: 100%;
  min-height: 2.4em;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  font-size: var(--text-2xs);
  line-height: 1.2;
  text-align: center;
  text-wrap: balance;
}
.more-sheet {
  padding-bottom: env(safe-area-inset-bottom);
}
</style>
