<script setup lang="ts">
import { AppIcon } from "@silvicom/ui";
import { Bars3Icon, ChevronLeftIcon, XMarkIcon } from "@silvicom/ui/icons";
import { computed, ref, watch } from "vue";
import { onKeyStroke, useWindowScroll } from "@vueuse/core";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { useQueryClient } from "@tanstack/vue-query";
import { Dialog, DialogPanel, TransitionRoot, TransitionChild } from "@headlessui/vue";
import { useSessionStore } from "@/stores/session";
import { buildNavGroups, type NavGroup } from "@/lib/nav";
import { PAGE_GUTTER_CLASS, heroPlate, heroVars, isFullBleed, sidebarIsCollapsed } from "@/lib/layout";
import { useColorScheme } from "@/composables/useColorScheme";
import { useModulesQuery } from "@/composables/useModules";
import { useNavCounts } from "@/composables/useNavCounts";
import NotificationBell from "@/components/NotificationBell.vue";
import AppSidebar from "@/layouts/sidebar/AppSidebar.vue";
import CommandPalette from "@/layouts/sidebar/CommandPalette.vue";
import { useRecordSidebarVisits } from "@/composables/useSidebarShortcuts";
import { currentItemKey } from "@/lib/sidebarShortcuts";
import { paletteEntries } from "@/lib/commandPalette";
import { visibleSettingsScreens } from "@/lib/settingsCards";
import SectionTabBar from "@/layouts/SectionTabBar.vue";
import { useOpens } from "@/composables/useOpens";
import { usePhoneFirst } from "@/composables/usePhoneFirst";
import { bottomChromeHeight } from "@/composables/bottomChrome";

const session = useSessionStore();
const opens = useOpens(); // SP5: "Back" to `meta.parent` only where the guard opens it (hazmat load → Loads).
const route = useRoute();
const router = useRouter();
const queryClient = useQueryClient();

/**
 * D-DR5: the outlet varies, the shell does not. See `isFullBleed` for why this is not a `layout`.
 */
const fullBleed = computed(() => isFullBleed(route));

/**
 * The page backdrop (D-DT18) — the shell's, not the page's.
 *
 * It sits behind bands the PAGE renders and bleeds past a gutter the SHELL owns, so neither half
 * could have drawn it alone. `heroPlate` answers which plate, including the refusal on a full-bleed
 * route; `useColorScheme` answers day or night, as it does for the live map's basemap (D-DR8) —
 * one place in the product decides whether the reader is in dark mode.
 */
const { isDark } = useColorScheme();
const plate = computed(() => heroPlate(route, isDark.value));

/**
 * The top bar steps back while the page is at rest on a plate (D-DT22).
 *
 * The plate used to start BELOW the bar and the main padding — 88px of empty canvas and a hairline
 * above a photograph that then began on a hard edge, which read as a strip pasted in rather than a
 * page that opens on a picture. The plate now runs up behind the bar, and the bar only takes its
 * material and rule once the page moves: at rest it would be a grey band drawn across the sky; in
 * motion it is the thing keeping the toggle and the bell legible over whatever scrolls under it.
 * That is the large-title navigation bar's behaviour, for the same reason. `useWindowScroll`
 * because the document scrolls, not `<main>`: a full-bleed route has no plate to step back from.
 */
const { y: scrollY } = useWindowScroll();
const barAtRest = computed(() => Boolean(plate.value) && scrollY.value < 8);

// Role-aware navigation, defined declaratively in @/lib/nav. UI gating only — RLS + API are the real enforcement.
const modules = useModulesQuery();
// The live counts beside sidebar entries, each asked only when its entry can show (useNavCounts).
const navCounts = useNavCounts(modules);
const navGroups = computed<NavGroup[]>(() =>
  buildNavGroups(
    session.role,
    modules.data.value ?? null,
    navCounts.value,
    // The org's overrides (D-PERM2). Without this the sidebar would keep answering from the shipped
    // matrix while every route guard and every API gate answered from the org's — a member granted a
    // section would have the page but no way to reach it.
    session.sections,
    // …and the org's SCREEN answers (D-SURF1, S3), on the same argument one layer along: without
    // this the sidebar would still offer a page the router guard now turns away from.
    session.surfaces,
  ),
);

// The shop's touch floor and tab row (DESIGN-SYSTEM-CONTRACT.md §9): `usePhoneFirst` has the why.
const { touch, tabs, currentTab } = usePhoneFirst(navGroups);

// Pre-build a Set of explicit nav paths for O(1) lookup — used to decide whether prefix matching
// is appropriate. If the current path IS an explicit nav item, only exact matches win; this
// prevents /settings/users from simultaneously highlighting both "Settings" and "Users".
const navPathSet = computed(() => new Set(navGroups.value.flatMap((g) => g.items.map((i) => i.to))));

/**
 * Returns true when the nav item at `to` should be marked active:
 *  - Exact match always wins.
 *  - Prefix match (e.g. /vehicles → /vehicles/abc) only applies when the current path
 *    is NOT itself an explicit nav item, so /settings/users never lights up /settings too.
 */
const isCurrent = (to: string): boolean => {
  if (to === "/") return route.path === "/";
  if (route.path === to) return true;
  if (!navPathSet.value.has(route.path)) return route.path.startsWith(to + "/");
  return false;
};

// Pinned and Recent's history (D-SB2): recorded once here, read by both sidebar instances.
useRecordSidebarVisits(() => currentItemKey(navGroups.value, isCurrent));

/**
 * "Go to a page" (D-SB1): ⌘K / Ctrl K from anywhere signed in, or the sidebar's search field. The
 * list is the sidebar's own groups plus the Settings screens the Settings page would show — both the
 * guard's answer already, so the palette can never offer a page the router refuses.
 */
const paletteOpen = ref(false);
const palette = computed(() =>
  paletteEntries(
    navGroups.value,
    visibleSettingsScreens(session.role, session.sections, session.surfaces).map((s) => ({ key: s.key, name: s.name, to: s.to, icon: s.icon })),
  ),
);
function openPalette() {
  mobileOpen.value = false;
  paletteOpen.value = true;
}
onKeyStroke(
  (e) => (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k",
  (e) => {
    e.preventDefault();
    if (paletteOpen.value) paletteOpen.value = false;
    else openPalette();
  },
);

// Mobile sidebar drawer state; auto-close on navigation.
const mobileOpen = ref(false);
watch(() => route.path, () => (mobileOpen.value = false));

/**
 * Collapsible desktop sidebar — persisted so it survives page refreshes, and collapsed by default on
 * a workspace surface (D-DR25). The rule itself is `sidebarIsCollapsed` in `lib/layout.ts`, which is
 * where its reasoning and its test live; this is the state it reads.
 */
const storedCollapsed = ref(localStorage.getItem("sidebar-collapsed") === "true");
/** What the reader did about the sidebar while on THIS workspace. Cleared when the surface changes. */
const collapseOverride = ref<boolean | null>(null);
watch(fullBleed, () => (collapseOverride.value = null));
const sidebarCollapsed = computed(() =>
  sidebarIsCollapsed({
    stored: storedCollapsed.value,
    fullBleed: fullBleed.value,
    override: collapseOverride.value,
  }),
);
const heroStyle = computed(() => heroVars(plate.value, sidebarCollapsed.value));
function toggleSidebar() {
  const next = !sidebarCollapsed.value;
  // On a workspace the choice is about this visit; on a document it is the preference, and only that
  // one is written down. See `sidebarIsCollapsed` for why the automatic collapse must not persist.
  if (fullBleed.value) collapseOverride.value = next;
  else {
    storedCollapsed.value = next;
    localStorage.setItem("sidebar-collapsed", String(next));
  }
}

async function signOut() {
  await session.signOut();
  queryClient.clear(); // drop cached data so nothing leaks to the next session
  await router.replace({ name: "login" });
}
</script>

<template>
  <div class="min-h-full">
    <!-- ── Mobile sidebar drawer (below lg) ─────────────────────────────── -->
    <TransitionRoot as="template" :show="mobileOpen">
      <Dialog class="relative z-dialog lg:hidden" @close="mobileOpen = false">
        <TransitionChild
          as="template"
          enter="transition-opacity ease-linear duration-300"
          enter-from="opacity-0"
          enter-to="opacity-100"
          leave="transition-opacity ease-linear duration-300"
          leave-from="opacity-100"
          leave-to="opacity-0"
        >
          <div class="fixed inset-0 bg-scrim/80 backdrop-blur-sm" />
        </TransitionChild>
        <div class="fixed inset-0 flex">
          <TransitionChild
            as="template"
            enter="transition ease-in-out duration-300 transform"
            enter-from="-translate-x-full"
            enter-to="translate-x-0"
            leave="transition ease-in-out duration-300 transform"
            leave-from="translate-x-0"
            leave-to="-translate-x-full"
          >
            <DialogPanel class="relative mr-14 flex w-full max-w-[18.5rem] flex-1">
              <div class="absolute top-0 left-full flex w-14 justify-center pt-3.5">
                <button
                  type="button"
                  class="sidebar-drawer-control -m-2.5 rounded-surface p-2.5"
                  @click="mobileOpen = false"
                >
                  <span class="sr-only">Close sidebar</span>
                  <AppIcon :icon="XMarkIcon" class="size-6 text-ink-inverse" aria-hidden="true" />
                </button>
              </div>
              <!-- The same sidebar as the desktop one (D-SB6), in a drawer. -->
              <AppSidebar
                drawer
                :groups="navGroups"
                :is-current="isCurrent"
                :touch="true"
                :email="session.email"
                :name="session.fullName"
                :role="session.role"
                @open-search="openPalette"
                @navigate="mobileOpen = false"
                @sign-out="signOut"
              />
            </DialogPanel>
          </TransitionChild>
        </div>
      </Dialog>
    </TransitionRoot>

    <!-- ── Desktop sidebar (lg+, fixed, collapsible) ─────────────────────── -->
    <div
      class="hidden lg:fixed lg:inset-y-0 lg:z-dialog lg:flex lg:flex-col transition-[width] duration-300 ease-out motion-reduce:transition-none"
      :class="sidebarCollapsed ? 'lg:w-[3.75rem]' : 'lg:w-[17rem]'"
    >
      <AppSidebar
        :groups="navGroups"
        :collapsed="sidebarCollapsed"
        :is-current="isCurrent"
        :touch="touch"
        :email="session.email"
        :name="session.fullName"
        :role="session.role"
        @toggle-collapse="toggleSidebar"
        @open-search="openPalette"
        @sign-out="signOut"
      />
    </div>

    <!-- ── Main content area ─────────────────────────────────────────────── -->
    <div
      class="transition-[padding] duration-300 ease-out motion-reduce:transition-none"
      :class="sidebarCollapsed ? 'lg:pl-[3.75rem]' : 'lg:pl-[17rem]'"
    >
      <!-- Sticky header ensures the hamburger toggle is always reachable on mobile. -->
      <header
        class="sticky top-0 z-chrome flex h-16 shrink-0 items-center px-4 transition-colors duration-200 ease-out sm:px-6 lg:px-8"
        :class="
          barAtRest
            ? 'bg-transparent'
            : 'border-b border-edge-subtle bg-canvas/95 backdrop-blur'
        "
      >
        <div class="flex items-center gap-x-3">
          <button
            type="button"
            class="sidebar-shell-toggle -m-3 rounded-control p-3 text-ink-secondary lg:hidden"
            @click="mobileOpen = true"
          >
            <span class="sr-only">Open sidebar</span>
            <AppIcon :icon="Bars3Icon" class="size-6" aria-hidden="true" />
          </button>
          <template v-if="route.meta.parent && opens(route.meta.parent as string)">
            <!-- The rule separates Back from the hamburger, which only exists below lg. -->
            <span class="h-5 w-px bg-edge-subtle lg:hidden" aria-hidden="true" />
            <RouterLink
              :to="(route.meta.parent as string)"
              :class="touch ? 'h-12 px-3' : 'h-9 px-2'"
              class="inline-flex items-center gap-1.5 rounded-control text-sm font-medium text-ink-secondary transition-colors hover:bg-surface-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              <AppIcon :icon="ChevronLeftIcon" class="size-4" aria-hidden="true" />
              Back
            </RouterLink>
          </template>
        </div>
        <!-- The office bell (DQF plan C6): the web reader of the same per-user inbox the driver
             app renders. -->
        <!-- `bar-float` while the bar is at rest on a plate (D-DT22): see style.css. -->
        <div class="ml-auto flex items-center rounded-control" :class="{ 'bar-float': barAtRest }">
          <NotificationBell />
        </div>
      </header>
      <!--
        Two outlets, one shell (D-DR5). A full-bleed route keeps the sidebar, the top bar and the
        bell, and changes only what is inside `<main>`: no vertical rhythm, no gutters, and a
        HEIGHT, so a page that wants to fill the viewport can — `h-full` inside a `<main>` with no
        height resolves to nothing at all, which is the failure this class exists to prevent.

        `100dvh` rather than `100vh`: on mobile Safari `vh` is the tallest the viewport ever gets,
        so a map sized against it hides its bottom edge under the browser's own chrome. `4rem` is
        the header above, which is `h-16` and sticky — a literal, because a CSS variable for a
        number that appears twice in one file would be indirection rather than derivation.

        ⚠ KNOWN, MEASURED, AND LEFT: `EnvironmentBanner` and `UpdateBanner` are siblings of this
        whole shell in `App.vue`, above it in the document, so when either is showing the page
        scrolls by exactly that banner's height — 28px, measured 2026-09-16 on the UAT banner. The
        map is not clipped and nothing is lost; the document simply gains a short scrollbar. Fixing
        it properly means a flex chain from `#app` down, which would restyle the layout container
        of every page in the product to buy 28px in the two environments a banner appears in. Named
        in DESIGN-REFRESH-2026-09.md §7 rather than traded for that.
      -->
      <main id="main-content" tabindex="-1" class="outline-none" :class="fullBleed ? 'h-[calc(100dvh-4rem)] overflow-hidden' : 'shell-main-padding'" :style="{ '--bottom-chrome': `${bottomChromeHeight}px` }">
        <!-- Full-width content: tables use the whole screen; small gutters only. -->
        <div
          class="relative"
          :class="fullBleed ? 'h-full' : ['w-full', PAGE_GUTTER_CLASS]"
          :style="heroStyle"
        >
          <!--
            ⚠ The layer is a SIBLING of the page, first in the document and inside the gutter's own
            box. First, so everything the page draws paints over it without a single band knowing it
            is there — one `position: relative` above, no z-index ladder, and no page needing to opt
            in. Inside the gutter's box, because an absolute layer sits on that box's PADDING edge,
            so `right: 0` reaches the window edge at every breakpoint (a bleed that negated the
            gutter again scrolled every plated page sideways until 2026-10-05). The classes are in
            `style.css` — see that block for the measurement and the crop arithmetic.

            Decorative, so `aria-hidden` and no `alt` text: a screen reader announcing "a truck on a
            highway" before the day's numbers is noise. The words that sit on it stay legible by the
            veil rather than by a scrim, measured in DASHBOARD-TEMPLATE-V2.md §4.0.
          -->
          <template v-if="plate">
            <div
              class="page-backdrop [--backdrop-lift:5.5rem]"
              aria-hidden="true"
            >
              <div class="page-backdrop__plate"></div>
              <div class="page-backdrop__veil"></div>
            </div>
            <!--
              ⚠ This wrapper is not decoration, and the bug it fixes is invisible in a unit test.
              CSS paints a POSITIONED descendant above an in-flow non-positioned one whatever the
              document order says, so a `z-index: 0` layer drawn first still covers the page: probed
              in the built stylesheet 2026-09-20, a white KPI card under a plate simply disappeared,
              with the truck rendered over the top of it. Making the page content positioned puts it
              back on top — this is the prototype's `.page > .band { position: relative }` rule,
              applied once by the shell so that not one band has to know the layer exists.

              ⚠ And it is inside `v-if` rather than always present: a full-bleed route has no
              backdrop, and giving the live map an extra static wrapper would break the `h-full`
              chain its outlet depends on. A page without a plate keeps exactly the DOM it had.
            -->
            <div class="relative"><slot /></div>
          </template>
          <slot v-else />
        </div>
      </main>
    </div>
    <SectionTabBar v-if="tabs" :group="tabs" :current="currentTab" />
    <CommandPalette :open="paletteOpen" :entries="palette" @close="paletteOpen = false" />
  </div>
</template>
