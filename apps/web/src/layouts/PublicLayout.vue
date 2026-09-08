<script setup lang="ts">
// Public, session-free layout (M7, extended by P3). No sidebar and no user chrome, so it renders for
// unauthenticated visitors and search crawlers. Reads nothing from the session store.
import { computed } from "vue";
import { useRoute } from "vue-router";
import AppLogo from "@/components/AppLogo.vue";
import { AppButton as BaseButton } from "@silvicom/ui";
import { COMPANY_NAME, PRODUCT_NAME } from "@/features/legal/legalMeta";

const route = useRoute();

/**
 * Which name heads the page.
 *
 * ── WHY THIS BECAME A ROUTE FACT ON 2026-09-08 ─────────────────────────────────────────────────
 * The header said "HazmatGuard" as a literal, which was right while this layout had exactly one page
 * in it — the free placard calculator, which markets that module. P3 put the privacy policy, the
 * terms and the support page in the same shell, and a privacy policy cannot be published under a
 * module's mark: the obligations in it are the company's. So the page says which name it belongs
 * under and the layout renders it, defaulting to the platform.
 */
const brand = computed(() => (route.meta.brand as string | undefined) ?? PRODUCT_NAME);
</script>

<template>
  <div class="flex min-h-full flex-col bg-surface-subtle">
    <header class="border-b border-edge bg-surface">
      <div class="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <div class="flex items-center gap-x-3">
          <AppLogo class="size-8" />
          <span class="text-sm font-semibold text-ink">{{ brand }}</span>
        </div>
        <BaseButton variant="soft" size="sm" to="/">Sign in</BaseButton>
      </div>
    </header>

    <main class="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
      <slot />
    </main>

    <!--
      The footer holds the three legal links and nothing else. It used to hold the placard
      calculator's specimen disclaimer, which moved onto that page in the same change: a disclaimer
      about 49 CFR §172.519 placard artwork is a fact about ONE page's output, and printing it under
      a privacy policy would have been both wrong and confusing. A layout carries what is true of
      every page in it.

      These links are also what makes the three documents reachable in the app's own terms —
      `routeReachability.test.ts` asks whether anything LINKS to a route, and a store listing is not
      something it can see.
    -->
    <footer class="border-t border-edge bg-surface">
      <div
        class="mx-auto flex max-w-5xl flex-wrap items-center gap-x-5 gap-y-2 px-6 py-6 text-xs text-ink-muted"
      >
        <span>© {{ new Date().getFullYear() }} {{ COMPANY_NAME }}</span>
        <RouterLink to="/privacy" class="hover:text-ink">Privacy</RouterLink>
        <RouterLink to="/terms" class="hover:text-ink">Terms</RouterLink>
        <RouterLink to="/support" class="hover:text-ink">Support</RouterLink>
      </div>
    </footer>
  </div>
</template>
