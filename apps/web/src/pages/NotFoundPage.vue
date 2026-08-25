<script setup lang="ts">
/**
 * The page the router reaches when nothing else matched (G1, UI-GAPS-PLAN.md).
 *
 * Before this existed there was no catch-all route at all: `App.vue` picks `AppShell` for any route
 * without `meta.layout`, an unmatched path has no matched record so `meta.layout` is undefined, and
 * the result was the full sidebar, header and notification bell wrapped around an empty `<main>`.
 * Silently — a mistyped URL, a link that rotted in somebody's email, and a route dropped by a bad
 * deploy all looked identical, and all three looked like the app was broken.
 *
 * It names the path it could not find. That is the whole design: a redirect to the dashboard would
 * be tidier and would destroy the only evidence the reader has.
 */
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { AppButton as BaseButton } from "@fuelguard/ui";
import { MagnifyingGlassIcon } from "@fuelguard/ui/icons";
import PageHeader from "@/components/ui/PageHeader.vue";
import ErrorPanel from "@/components/ErrorPanel.vue";
import { useSessionStore } from "@/stores/session";

const route = useRoute();
const router = useRouter();
const session = useSessionStore();

// `fullPath` rather than `path`: a wrong query string is as much a broken link as a wrong path, and
// the reader cannot see what they typed if we trim half of it away.
const attempted = computed(() => route.fullPath);

/**
 * Only offer "go back" when there is something to go back to. `history.state.back` is null on a
 * cold load — somebody following a dead link from an email has no previous entry in this session,
 * and a back button that silently does nothing is worse than no back button.
 */
const canGoBack = computed(() => window.history.state?.back != null);
</script>

<template>
  <div>
    <PageHeader description="That address does not match anything in FuelGuard." />
    <ErrorPanel
      :icon="MagnifyingGlassIcon"
      message="Check the address for a typo. If you followed a link from an email or a bookmark, the page it pointed at may have moved or been renamed."
      detail-label="Not found:"
      :detail="attempted"
    >
      <BaseButton v-if="session.isAuthenticated" variant="primary" to="/">Go to the dashboard</BaseButton>
      <BaseButton v-else variant="primary" to="/login">Sign in</BaseButton>
      <BaseButton v-if="canGoBack" variant="secondary" @click="router.back()">Go back</BaseButton>
    </ErrorPanel>
  </div>
</template>
