<script setup lang="ts">
// Public, session-free marketing layout (M7). No sidebar and no user chrome, so it renders for
// unauthenticated visitors and search crawlers. Reads nothing from the session store.
import AppLogo from "@/components/AppLogo.vue";
import { AppButton as BaseButton } from "@fuelguard/ui";
</script>

<template>
  <div class="flex min-h-full flex-col bg-surface-subtle">
    <header class="border-b border-edge bg-surface">
      <div class="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <div class="flex items-center gap-x-3">
          <AppLogo class="size-8" />
          <span class="text-sm font-semibold text-ink">HazmatGuard</span>
        </div>
        <BaseButton variant="soft" size="sm" to="/">Sign in</BaseButton>
      </div>
    </header>

    <main class="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
      <slot />
    </main>

    <footer class="border-t border-edge bg-surface">
      <div class="mx-auto max-w-5xl px-6 py-6 text-xs text-ink-muted">
        <p>
          Placard images shown are <strong>specimens</strong> for identification, not regulation-ready artwork
          (49 CFR §172.519). Results are informational and derived from the published HMT/CFR; the carrier
          remains responsible for compliance under 49 CFR §177.817.
        </p>
      </div>
    </footer>
  </div>
</template>
