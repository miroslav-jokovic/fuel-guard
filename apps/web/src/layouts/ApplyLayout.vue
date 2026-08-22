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
defineProps<{ carrier: string | null }>();
</script>

<template>
  <div class="flex min-h-full flex-col bg-surface-subtle">
    <header class="border-b border-edge bg-surface">
      <div class="mx-auto flex max-w-3xl items-center gap-x-3 px-6 py-4">
        <AppLogo class="size-8" />
        <span class="text-sm font-semibold text-ink">{{ carrier ?? "Driver application" }}</span>
      </div>
    </header>

    <main class="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
      <slot />
    </main>

    <footer class="border-t border-edge bg-surface">
      <div class="mx-auto max-w-3xl px-6 py-6 text-xs text-ink-muted">
        <p>
          This application is collected for
          <span class="font-medium text-ink-secondary">{{ carrier ?? "the carrier" }}</span>
          and processed on their behalf by FuelGuard. Your answers are shared with the carrier only.
        </p>
      </div>
    </footer>
  </div>
</template>
