<script setup lang="ts">
import { useRouter } from "vue-router";
import { AppButton as BaseButton, AppIcon } from "@silvicom/ui";
import { ChevronLeftIcon } from "@silvicom/ui/icons";

/**
 * The shell for a phone held in a bay (D-INV17, INVENTORY-PLAN.md I5 PR 2b).
 *
 * ── WHY THE SHOP GETS ITS OWN SHELL AND DOES NOT BORROW `AppShell` ────────────────────────────
 * Every other inventory screen is a desk screen and lives in the app shell. This one is used with
 * one thumb, standing up, next to a shelf, and four of the app shell's properties are actively
 * wrong there:
 *
 *   · **the sidebar**. A count is a task with a start and an end; a menu beside it is thirty ways to
 *     lose the walk you are halfway through, on a screen where the back gesture is a thumb-width
 *     from the edge;
 *   · **page scroll**. `overscroll-behavior-y: contain` stops the rubber-band that fires
 *     pull-to-refresh in Safari, which on this screen means reloading mid-count;
 *   · **the viewport**. `100dvh` rather than `100vh`, because Safari's `100vh` includes the URL bar
 *     that is not there, so a sticky bottom bar sits under the fold until the user scrolls;
 *   · **the safe area**. A bottom bar without `env(safe-area-inset-bottom)` puts the primary action
 *     under the home indicator on every iPhone since the X.
 *
 * ── BACK IS IN THE CONTENT, NOT IN CHROME ─────────────────────────────────────────────────────
 * There is no nav to go "up" to. The only meaningful exit from a count is the shop home, and it is
 * one control at the top of the page — which also keeps it inside the safe area at the top, where a
 * notch would otherwise eat a fixed header.
 *
 * ── THE BOTTOM BAR IS A TELEPORT TARGET, NOT A SLOT ───────────────────────────────────────────
 * `App.vue` renders `<RouterView />` inside this shell, so a slot here would have to be filled by
 * `App.vue` and not by the page — which is the one place that knows what the primary action is. The
 * page teleports into `#shop-action-bar` instead. The strip collapses with `:empty` when no page has
 * filled it, so a screen with no primary action does not grow an empty band above the home
 * indicator.
 */
const router = useRouter();
</script>

<template>
  <div class="shop-shell flex flex-col bg-surface-subtle">
    <div class="flex-1 overflow-y-auto">
      <div class="mx-auto w-full max-w-2xl px-4 py-4">
        <BaseButton variant="ghost" size="sm" class="-ml-2 mb-3" @click="router.push('/shop')">
          <AppIcon :icon="ChevronLeftIcon" class="-ml-1 size-4" aria-hidden="true" /> Shop
        </BaseButton>
        <slot />
      </div>
    </div>

    <div id="shop-action-bar" class="shop-bar sticky bottom-0 border-t border-edge bg-surface" />
  </div>
</template>

<style scoped>
/**
 * The four properties in one place, because three of them cannot be expressed as utilities without
 * an arbitrary value and `lint:tokens` is right to refuse those.
 *
 * `100dvh` is the dynamic viewport — it shrinks as Safari's URL bar appears, which is exactly what
 * `100vh` does not do and why a bottom bar drifts under the fold on iOS.
 */
.shop-shell {
  min-height: 100dvh;
  overscroll-behavior-y: contain;
}

/**
 * The action bar the page teleports into. `:empty` collapses it entirely — border included — so a
 * screen that fills it gets a bar and a screen that does not gets nothing, without either of them
 * having to say so.
 */
.shop-bar {
  padding: 0.75rem 1rem calc(0.75rem + env(safe-area-inset-bottom));
}

.shop-bar:empty {
  display: none;
}
</style>
