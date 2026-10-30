<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import AppShell from "@/layouts/AppShell.vue";
import AuthLayout from "@/layouts/AuthLayout.vue";
import PublicLayout from "@/layouts/PublicLayout.vue";
import ApplyLayout from "@/layouts/ApplyLayout.vue";
import ShopLayout from "@/layouts/ShopLayout.vue";
import ToastContainer from "@/components/ToastContainer.vue";
import { ConfirmHost, provideRouteOpens } from "@silvicom/ui";
import ErrorBoundary from "@/components/ErrorBoundary.vue";
import UpdateBanner from "@/components/UpdateBanner.vue";
import EnvironmentBanner from "@/components/EnvironmentBanner.vue";
import SkipLink from "@/components/SkipLink.vue";
import AssistantLauncher from "@/components/assistant/AssistantLauncher.vue";
import ScannerRelayBar from "@/components/ScannerRelayBar.vue";
import { useSessionStore } from "@/stores/session";
import { resolveLayout } from "@/lib/layout";
import { useOpens } from "@/composables/useOpens";

const route = useRoute();
const router = useRouter();
const session = useSessionStore();
// Whether a route opens for this reader, for the shared pieces in `@silvicom/ui` that offer a way to
// one (`NotFoundState`'s "Back to <list>"). The answer is the app's (SP5), so the app provides it.
provideRouteOpens(useOpens());
/**
 * No shell until the router has resolved the first URL (2026-10-13).
 *
 * Before that, `route` is the router's start location: no meta, so `resolveLayout` answers
 * `undefined` — the signed-in `AppShell` — for every URL, `/login` included. The shell mounted for a
 * moment on the sign-in page and fired its reads with no session: `/api/me/notifications` answered 401,
 * and `org_modules` answered `[]` with the anon key, which the cache kept for five minutes, so the
 * person who then signed in had no Loads, no Dispatch board and no dispatch cards until a reload
 * (measured on staging as a fleet manager; `useModules.ts` carries the other half of the fix). The
 * banners above the shells stay, so the first frame still says which deployment this is.
 */
const routerReady = ref(false);
void router.isReady().then(() => (routerReady.value = true));
/**
 * G1 — one route can render in two shells depending on the session; the rule is in `lib/layout.ts`.
 * `null` until the router is ready, so no layout — and no `isShellLayout` reader, the skip link and
 * the assistant launcher included — acts on the start location.
 */
const layout = computed(() => (routerReady.value ? resolveLayout(route.meta, session.isAuthenticated) : null));
/** The page knows the carrier's name only after the invitation resolves; the header shows it then. */
const applyCarrier = ref<string | null>(null);
const isAuthLayout = computed(() => layout.value === "auth");
const isPublicLayout = computed(() => layout.value === "public");
const isLabLayout = computed(() => layout.value === "lab");
/**
 * The applicant's layout (H5b). Its own rather than `public`, because that one is a marketing
 * surface with a Sign in button — a dead end for somebody who has no account and is being asked for
 * their date of birth. The carrier's name comes from the page via a route-scoped ref.
 */
const isApplyLayout = computed(() => layout.value === "apply");
/**
 * The signing surface asks for the wider container (C1), by the same route-scoped channel the
 * carrier's name already uses.
 *
 * ⚠ It is NOT `meta.fullBleed`: that is read by `AppShell` alone, and this route never renders
 * `AppShell`. `ApplyLayout`'s own header carries the measurement. ⚠ And it is a property of a
 * SCREEN rather than of a route — `/apply/:token` is a form for seven screens and a signing surface
 * for one — which is the same reason `isFullBleed` had to start reading the dashboard's tab from
 * the URL rather than a static boolean (D-DR24).
 */
const applyWide = ref(false);
// ⚠ Reset on navigation, or a driver who signs and then opens a fresh link gets the wide container
// on the address form. The carrier's name is re-emitted on every load and so needs no such reset;
// a boolean that is only ever emitted `true` does.
watch(() => route.fullPath, () => { applyWide.value = false; });
/**
 * The shop's own shell (D-INV17): a phone in a bay, no sidebar, a sticky bottom action bar. It is
 * NOT wrapped in `ErrorBoundary` for the reason the boundary's own comment gives about the other
 * standalone shells — but the reason is different enough to state: a count screen that threw would
 * be better off showing the boundary's dead end than a blank page, and the page's own `#bar` is
 * what it would replace. It is left outside deliberately for now and named in the plan's §8.
 */
const isShopLayout = computed(() => layout.value === "shop");
const isShellLayout = computed(() => layout.value === undefined);
</script>

<template>
  <!-- Which deployment this is. Above everything, including the sign-in page: the moment you most
       need to know you are not on production is before you type a password into it. -->
  <EnvironmentBanner />
  <!-- New-deploy banner: above every layout so it's visible on any page, not just the dashboard. -->
  <UpdateBanner />
  <!-- First in the tab order, over the banners too; only over the shell, whose sidebar is the block to bypass.
       The other layouts put at most one control before their content, and a link past one is noise. -->
  <SkipLink v-if="isShellLayout" />
  <!-- Which device the office scanner's scans go to (SCANNER-RELAY-PLAN.md D-SR3), on every signed-in
       page of both shells — the shop's tablet screens included, which is where it is used most. -->
  <ScannerRelayBar v-if="(isShellLayout || isShopLayout) && session.isAuthenticated" />
  <template v-if="layout === null" />
  <RouterView v-else-if="isLabLayout" />
  <AuthLayout v-else-if="isAuthLayout">
    <RouterView />
  </AuthLayout>
  <PublicLayout v-else-if="isPublicLayout">
    <RouterView />
  </PublicLayout>
  <ApplyLayout v-else-if="isApplyLayout" :carrier="applyCarrier" :wide="applyWide">
    <RouterView @carrier="applyCarrier = $event" @wide="applyWide = $event" />
  </ApplyLayout>
  <ShopLayout v-else-if="isShopLayout">
    <RouterView />
  </ShopLayout>
  <AppShell v-else>
    <!--
      Q-UI5 — only the app shell is wrapped. The auth, apply and public layouts are small static
      pages with no data behind them, and `/__design-system` is a dev surface where an error should
      be loud rather than caught. Wrapping the shell puts the boundary exactly where the 61
      data-driven pages live.
    -->
    <ErrorBoundary>
      <RouterView />
    </ErrorBoundary>
  </AppShell>
  <!-- The assistant's launcher and dock (F21). Here rather than in `AppShell` because it floats over
       the shell rather than living in it, beside the toasts; it renders only for a signed-in shell
       page, and only for someone the `ask-ai` surface admits. -->
  <AssistantLauncher v-if="isShellLayout && session.isAuthenticated" />
  <ToastContainer />
  <!-- D-US7: the one "are you sure?", drawn for every layout in place of window.confirm. -->
  <ConfirmHost />
</template>
