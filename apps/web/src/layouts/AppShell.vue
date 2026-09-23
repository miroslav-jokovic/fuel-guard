<script setup lang="ts">
import { AppIcon } from "@silvicom/ui";
import {
  Bars3Icon,
  ChevronLeftIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  XMarkIcon,
} from "@silvicom/ui/icons";
import { computed, ref, watch } from "vue";
import { useWindowScroll } from "@vueuse/core";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { useQueryClient } from "@tanstack/vue-query";
import { Dialog, DialogPanel, TransitionRoot, TransitionChild } from "@headlessui/vue";
import { moduleEnabled } from "@silvicom/shared";
import { useSessionStore } from "@/stores/session";
import { buildNavGroups, type NavGroup } from "@/lib/nav";
import { heroPlate, isFullBleed, sidebarIsCollapsed } from "@/lib/layout";
import { useColorScheme } from "@/composables/useColorScheme";
import { useModulesQuery } from "@/composables/useModules";
import NotificationBell from "@/components/NotificationBell.vue";
import { useHazmatReviewCountQuery } from "@/features/hazmat/useHazmatReview";
import { useThreadsQuery } from "@/features/messages/useMessages";
import AppLogo from "@/components/AppLogo.vue";
import AppWordmark from "@/components/AppWordmark.vue";
import SidebarFlyoutSection from "@/layouts/SidebarFlyoutSection.vue";
import SidebarNavSection from "@/layouts/SidebarNavSection.vue";
import { useSidebarSections } from "@/composables/useSidebarSections";
import SidebarProfileMenu from "@/layouts/SidebarProfileMenu.vue";

const session = useSessionStore();
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
 * because the document scrolls, not `<main>` — a full-bleed route has no plate, so its own
 * overflow container never needs asking.
 */
const { y: scrollY } = useWindowScroll();
const barAtRest = computed(() => Boolean(plate.value) && scrollY.value < 8);

// Role-aware navigation, defined declaratively in @/lib/nav. UI gating only — RLS + API are the real enforcement.
const modules = useModulesQuery();
// Pending-hazmat-review count for the nav badge (only queried when the module + view access are present).
const hazmatVisible = computed(() =>
  session.canView("hazmat") && moduleEnabled(modules.data.value ?? null, "hazmatguard"),
);
const reviewCount = useHazmatReviewCountQuery(hazmatVisible);
// Messages unread for the nav badge (Phase 7) — same one-fetch-two-surfaces query the inbox uses.
const messagesVisible = computed(() =>
  session.canView("dispatch") && moduleEnabled(modules.data.value ?? null, "messages"),
);
const threadsQ = useThreadsQuery(messagesVisible);
const navGroups = computed<NavGroup[]>(() =>
  buildNavGroups(
    session.role,
    modules.data.value ?? null,
    {
      hazmatReview: reviewCount.data.value ?? 0,
      messagesUnread: threadsQ.data.value?.unread_total ?? 0,
    },
    // The org's overrides (D-PERM2). Without this the sidebar would keep answering from the shipped
    // matrix while every route guard and every API gate answered from the org's — a member granted a
    // section would have the page but no way to reach it.
    session.sections,
    // …and the org's SCREEN answers (D-SURF1, S3), on the same argument one layer along: without
    // this the sidebar would still offer a page the router guard now turns away from.
    session.surfaces,
  ),
);

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

const activeClass = (to: string) =>
  isCurrent(to) ? "sidebar-nav-active" : "sidebar-nav-inactive";

/** Full expanded nav link — used in mobile drawer and expanded desktop sidebar. */
const navLinkClass = (to: string) => [
  activeClass(to),
  "sidebar-nav-item group flex min-h-10 items-center gap-x-2.5 rounded-control px-2.5 py-2 text-sm font-medium leading-5",
];

/**
 * The section that owns the page you are on. `useSidebarSections` keeps it open regardless of what
 * was stored, so a deep link or a post-sign-in redirect can never land inside a collapsed section.
 */
const currentSection = () =>
  navGroups.value.find((group) => group.label && group.items.some((item) => isCurrent(item.to)))
    ?.label ?? null;
const { isOpen: sectionOpen, toggle: toggleSection } = useSidebarSections(currentSection);

/** Icon-only nav link — used in collapsed desktop sidebar. */
const navLinkClassCollapsed = (to: string) => [
  activeClass(to),
  "sidebar-nav-item flex min-h-9 items-center justify-center rounded-control p-2",
];

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
/**
 * How much wider than a 1440 window's content the page is, and so how much the hero may grow.
 *
 * ⚠ Reported by the owner 2026-09-23, twice. At a FIXED 232px band the truck can only be so large
 * before its roof or its wheels leave the band, so the first fix for a wide screen capped the
 * photograph at its 1440 width — correct framing, and a small picture parked at the right of a
 * 2470px screen with empty canvas beside it. The band's height was the real constraint, so now the
 * plate's width AND the band's height grow together with this one measurement (the arithmetic is in
 * style.css at `.page-backdrop`). It is the content width, not the window's, which is why the
 * sidebar's width is in it: collapsing the sidebar is more room, and the hero takes it.
 * 73rem is 1104px of content plus the 2 × 2rem gutter — a 1440 window with the sidebar open, where
 * the plate was framed. 87.5rem stops the growth at a ~3900px window.
 */
const heroVars = computed(() => ({
  "--backdrop-plate": `url(${plate.value})`,
  "--hero-room": `clamp(0px, 100vw - ${sidebarCollapsed.value ? "3.75rem" : "17rem"} - 73rem, 87.5rem)`,
  // Declared HERE, beside the room it reads: a custom property resolves its var()s where it is
  // declared, so defined on :root it would read an unset room and be 0 everywhere.
  "--hero-grow": "calc(var(--hero-room) * 0.035)",
}));

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
              <!-- Mobile sidebar body -->
              <div class="sidebar-glass relative flex grow overflow-hidden border-r">
                <div class="sidebar-glass-material" aria-hidden="true" />
                <div
                  class="sidebar-glass-content flex min-h-0 grow flex-col overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden px-3 pb-3"
                >
                  <!-- Same size and placement as the desktop header below. -->
                  <div
                    class="sidebar-divider flex h-16 shrink-0 items-center justify-center border-b px-2.5"
                  >
                    <AppWordmark class="h-10" />
                  </div>
                  <nav aria-label="Primary navigation" class="flex flex-1 flex-col pt-2">
                    <ul class="flex flex-1 flex-col gap-y-0.5">
                      <template v-for="group in navGroups" :key="group.label ?? '_top'">
                        <SidebarNavSection
                          v-if="group.label"
                          :group="group"
                          :open="sectionOpen(group.label)"
                          :is-current="isCurrent"
                          :nav-link-class="navLinkClass"
                          @toggle="toggleSection(group.label)"
                        />
                        <li v-for="item in group.items" v-else :key="item.name">
                          <RouterLink
                            :to="item.to"
                            :class="navLinkClass(item.to)"
                            :aria-current="isCurrent(item.to) ? 'page' : undefined"
                          >
                            <AppIcon :icon="item.icon" class="size-5 shrink-0" aria-hidden="true" />
                            <span class="flex-1">{{ item.name }}</span>
                            <span
                              v-if="item.badge"
                              class="sidebar-nav-badge rounded-full px-1.5 py-0.5 text-xs font-semibold"
                              >{{ item.badge }}</span
                            >
                          </RouterLink>
                        </li>
                      </template>
                    </ul>
                  </nav>
                  <!-- Account menu at the bottom of the mobile drawer. -->
                  <div class="sidebar-divider mt-4 border-t pt-3">
                    <SidebarProfileMenu
                      :email="session.email"
                      :name="session.fullName"
                      :role="session.role"
                      :can-manage="session.can('settings')"
                      @sign-out="signOut"
                    />
                  </div>
                </div>
              </div>
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
      <div class="sidebar-glass relative flex grow overflow-hidden border-r">
        <div class="sidebar-glass-material" aria-hidden="true" />
        <div class="sidebar-glass-content flex min-h-0 grow flex-col overflow-x-hidden">
          <!-- Sidebar header -->
          <div
            class="sidebar-divider flex h-16 shrink-0 items-center justify-center border-b"
            :class="sidebarCollapsed ? 'px-2' : 'px-3'"
          >
            <AppLogo v-if="sidebarCollapsed" class="size-7 shrink-0" />
            <!--
              The mark is centred rather than aligned to the nav icon column, and the whole chrome
              band went 3.5rem → 4rem to give it room: the wordmark is a two-line lockup, so height
              buys far less apparent size than it would for a single-line mark. It shipped at h-5 on
              2026-08-29 with each 360 disc ~9px tall, went to h-8, and reads properly at h-10 —
              ~21px of wordmark over a 14px nav label, with 12px of air above and below.

              h-16 is duplicated by the mobile drawer header above and the main sticky header below,
              on purpose: the three form one horizontal rule across the top of the app, and a
              sidebar header taller than the content header would break it. Move all three or none.
            -->
            <AppWordmark v-else class="h-10" />
          </div>

          <!-- Nav -->
          <nav
            id="desktop-sidebar-navigation"
            aria-label="Primary navigation"
            class="flex flex-1 min-h-0 flex-col overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden pt-2"
            :class="sidebarCollapsed ? 'px-2' : 'px-3'"
          >
            <!-- Expanded: grouped section labels + full links -->
            <ul v-if="!sidebarCollapsed" class="flex flex-1 flex-col gap-y-0.5">
              <template v-for="group in navGroups" :key="group.label ?? '_top'">
                <SidebarNavSection
                  v-if="group.label"
                  :group="group"
                  :open="sectionOpen(group.label)"
                  :is-current="isCurrent"
                  :nav-link-class="navLinkClass"
                  @toggle="toggleSection(group.label)"
                />
                <li v-for="item in group.items" v-else :key="item.name">
                  <RouterLink
                    :to="item.to"
                    :class="navLinkClass(item.to)"
                    :aria-current="isCurrent(item.to) ? 'page' : undefined"
                  >
                    <AppIcon :icon="item.icon" class="size-5 shrink-0" aria-hidden="true" />
                    <span class="flex-1">{{ item.name }}</span>
                    <span
                      v-if="item.badge"
                      class="sidebar-nav-badge rounded-full px-1.5 py-0.5 text-xs font-semibold"
                      >{{ item.badge }}</span
                    >
                  </RouterLink>
                </li>
              </template>
            </ul>
            <!-- Collapsed: ungrouped items as icons; each labeled section opens a flyout submenu on hover/click -->
            <ul v-else class="flex flex-1 flex-col gap-y-1">
              <template v-for="group in navGroups" :key="group.label ?? '_top'">
                <template v-if="!group.label">
                  <li v-for="item in group.items" :key="item.name">
                    <RouterLink
                      :to="item.to"
                      :class="navLinkClassCollapsed(item.to)"
                      :title="item.name"
                      :aria-current="isCurrent(item.to) ? 'page' : undefined"
                    >
                      <AppIcon :icon="item.icon" class="size-5 shrink-0" aria-hidden="true" />
                    </RouterLink>
                  </li>
                </template>
                <li v-else>
                  <SidebarFlyoutSection :group="group" :is-current="isCurrent" />
                </li>
              </template>
            </ul>
          </nav>

          <!-- Account control stays visually separate from primary navigation. -->
          <div
            class="sidebar-divider mt-2 shrink-0 border-t py-2.5"
            :class="sidebarCollapsed ? 'px-2' : 'px-2.5'"
          >
            <SidebarProfileMenu
              :email="session.email"
              :name="session.fullName"
              :role="session.role"
              :collapsed="sidebarCollapsed"
              :can-manage="session.can('settings')"
              @sign-out="signOut"
            />
          </div>
        </div>
      </div>
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
            class="sidebar-shell-toggle -m-2.5 rounded-control p-2.5 text-ink-secondary lg:hidden"
            @click="mobileOpen = true"
          >
            <span class="sr-only">Open sidebar</span>
            <AppIcon :icon="Bars3Icon" class="size-6" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="sidebar-shell-toggle -ml-2 hidden size-9 items-center justify-center rounded-control text-ink-tertiary transition-colors hover:bg-surface-muted hover:text-ink lg:inline-flex"
            :title="sidebarCollapsed ? 'Expand navigation' : 'Collapse navigation'"
            :aria-label="sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'"
            :aria-expanded="!sidebarCollapsed"
            aria-controls="desktop-sidebar-navigation"
            @click="toggleSidebar"
          >
            <AppIcon
              :icon="sidebarCollapsed ? PanelLeftOpenIcon : PanelLeftCloseIcon"
              class="size-5"
              aria-hidden="true"
            />
          </button>
          <template v-if="route.meta.parent">
            <span class="h-5 w-px bg-edge-subtle" aria-hidden="true" />
            <RouterLink
              :to="(route.meta.parent as string)"
              class="inline-flex h-9 items-center gap-1.5 rounded-control px-2 text-sm font-medium text-ink-secondary transition-colors hover:bg-surface-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
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
      <main :class="fullBleed ? 'h-[calc(100dvh-4rem)] overflow-hidden' : 'py-6'">
        <!-- Full-width content: tables use the whole screen; small gutters only. -->
        <div
          class="relative"
          :class="fullBleed ? 'h-full' : 'w-full px-4 sm:px-6 lg:px-8'"
          :style="plate ? heroVars : undefined"
        >
          <!--
            ⚠ The layer is a SIBLING of the page, first in the document and inside the gutter's own
            box. First, so everything the page draws paints over it without a single band knowing it
            is there — one `position: relative` above, no z-index ladder, and no page needing to opt
            in. Inside the gutter's box, because the bleed is expressed as a negative of that exact
            padding: `--backdrop-bleed` carries the gutter's current value at each breakpoint, so the
            plate reaches the window edge at 1440 and at 820 without either number being written
            twice. The classes are in `style.css` — see that block for the crop arithmetic.

            Decorative, so `aria-hidden` and no `alt` text: a screen reader announcing "a truck on a
            highway" before the day's numbers is noise. The words that sit on it stay legible by the
            veil rather than by a scrim, measured in DASHBOARD-TEMPLATE-V2.md §4.0.
          -->
          <template v-if="plate">
            <div
              class="page-backdrop [--backdrop-bleed:1rem] [--backdrop-lift:5.5rem] sm:[--backdrop-bleed:1.5rem] lg:[--backdrop-bleed:2rem]"
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
  </div>
</template>
