<script setup lang="ts">
/**
 * "Skip to main content" — the first thing Tab reaches on a page with a navigation in front of it
 * (WCAG 2.4.1, Bypass Blocks).
 *
 * The app shell puts about forty sidebar entries before every page's content: measured 2026-10-04 on
 * Fuel Costs, a keyboard reached "Export report" on its 48th Tab, 40 of them the sidebar (design verdict
 * 03, E8). Hidden until focused, so a mouse user never sees it.
 *
 * ⚠ The click moves FOCUS, not just the scroll. A bare `#main-content` anchor scrolls in every browser
 * but leaves focus where it was in some, so the next Tab lands back in the sidebar — the bug a skip link
 * exists to remove. The target carries `tabindex="-1"` so it can take focus without joining the tab
 * order, and the hash never reaches the URL, where `useQueryState` and a shared link would carry it.
 *
 * The app shell's `<main>` carries `id="main-content"` (`MAIN_CONTENT_ID`), and the link shows over the shell only;
 * `skipLink.test.ts` holds both, so the link cannot ship pointing nowhere.
 */
import { MAIN_CONTENT_ID } from "@/lib/layout";

function skip(): void {
  document.getElementById(MAIN_CONTENT_ID)?.focus();
}
</script>

<template>
  <a
    :href="`#${MAIN_CONTENT_ID}`"
    class="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-toast focus:rounded-control focus:bg-action-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-action-primary-foreground"
    @click.prevent="skip"
  >
    Skip to main content
  </a>
</template>
