<script setup lang="ts">
import AppLogo from "@/components/AppLogo.vue";

/**
 * The layout an applicant sees (H5b). Session-free, and deliberately not `PublicLayout`.
 *
 * That layout is a marketing surface: it says HazmatGuard across the top and offers a Sign in
 * button. Neither belongs here. Somebody filling in a §391.21 application is applying to a CARRIER,
 * not evaluating our product, and they have no account to sign in to — offering one is an invitation
 * to a dead end for a person who is already being asked for their date of birth by a stranger.
 *
 * So the chrome is minimal and the carrier's name is what the page announces. The one thing this
 * footer does say about us is who is processing the form, because a person handing over personal
 * data is owed the name of whoever is holding it.
 */
/**
 * ── ⚠ THE WIDTH ESCAPE, AND WHY IT IS A PROP RATHER THAN `meta.fullBleed` (C1) ────────────────
 * The plan's C1 row said to reach for `meta.fullBleed` (D-HUI6). Measured 2026-09-19, that is a
 * **no-op on this route**: `fullBleed` is read by `isFullBleed()` in `lib/layout.ts`, which is
 * called by `AppShell.vue` and nothing else — and `/apply/:token` carries `layout: "apply"`, so
 * `App.vue` renders THIS component and never `AppShell`. D-HUI6's *reasoning* stands (do not add a
 * sixth `LayoutName`, because every name in it replaces the whole shell); only its named mechanism
 * does not reach here.
 *
 * ⚠ And what the signing screen needs is smaller than "full bleed" sounds. `max-w-3xl` is 768px and
 * D-HUI9 measured the packet as fully readable at 765px — the width this layout already had is,
 * by accident, within three pixels of the one the measurement blessed. The page does not need to
 * grow. What needs room is the page PLUS the rail of twenty-two places beside it, which is a
 * desktop concern only: below `lg` the rail is a strip above the document and 3xl is still right.
 *
 * So `wide` widens the container by one step and nothing else. The chrome widens with it, because a
 * header pinned at 768px above a 1152px document reads as a misalignment rather than a choice.
 */
defineProps<{ carrier: string | null; wide?: boolean }>();
</script>

<template>
  <div class="flex min-h-full flex-col bg-surface-subtle">
    <header class="border-b border-edge bg-surface">
      <div class="mx-auto flex items-center gap-x-3 px-6 py-4" :class="wide ? 'max-w-6xl' : 'max-w-3xl'">
        <AppLogo class="size-8" />
        <span class="text-sm font-semibold text-ink">{{ carrier ?? "Driver application" }}</span>
      </div>
    </header>

    <main class="mx-auto w-full flex-1 px-6 py-8" :class="wide ? 'max-w-6xl' : 'max-w-3xl'">
      <slot />
    </main>

    <footer class="border-t border-edge bg-surface">
      <div class="mx-auto px-6 py-6 text-xs text-ink-muted" :class="wide ? 'max-w-6xl' : 'max-w-3xl'">
        <p>
          This application is collected for
          <span class="font-medium text-ink-secondary">{{ carrier ?? "the carrier" }}</span>
          and processed on their behalf by Silvicom 360. Your answers are shared with the carrier only.
        </p>
      </div>
    </footer>
  </div>
</template>
