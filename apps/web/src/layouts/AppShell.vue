<script setup lang="ts">
import { AppIcon } from "@fuelguard/ui";
import {
  Bars3Icon,
  ChevronLeftIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  XMarkIcon,
} from "@fuelguard/ui/icons";
import { computed, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { useQueryClient } from "@tanstack/vue-query";
import { Dialog, DialogPanel, TransitionRoot, TransitionChild } from "@headlessui/vue";
import { canViewSection, moduleEnabled } from "@fuelguard/shared";
import { useSessionStore } from "@/stores/session";
import { buildNavGroups, type NavGroup } from "@/lib/nav";
import { useModulesQuery } from "@/composables/useModules";
import { useHazmatReviewCountQuery } from "@/features/hazmat/useHazmatReview";
import AppLogo from "@/components/AppLogo.vue";
import SidebarFlyoutSection from "@/layouts/SidebarFlyoutSection.vue";
import SidebarProfileMenu from "@/layouts/SidebarProfileMenu.vue";

const session = useSessionStore();
const route = useRoute();
const router = useRouter();
const queryClient = useQueryClient();

// Role-aware navigation, defined declaratively in @/lib/nav. UI gating only — RLS + API are the real enforcement.
const modules = useModulesQuery();
// Pending-hazmat-review count for the nav badge (only queried when the module + view access are present).
const hazmatVisible = computed(() =>
  canViewSection(session.role, "hazmat") && moduleEnabled(modules.data.value ?? null, "hazmatguard"),
);
const reviewCount = useHazmatReviewCountQuery(hazmatVisible);
const navGroups = computed<NavGroup[]>(() =>
  buildNavGroups(session.role, modules.data.value ?? null, { hazmatReview: reviewCount.data.value ?? 0 }),
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
  isCurrent(to)
    ? "bg-white/[0.12] text-white ring-1 ring-inset ring-white/[0.16] shadow-[inset_0_1px_0_rgb(255_255_255/0.08),0_6px_18px_rgb(0_0_0/0.08)]"
    : "text-neutral-300 hover:bg-white/[0.085] hover:text-white";

/** Full expanded nav link — used in mobile drawer and expanded desktop sidebar. */
const navLinkClass = (to: string) => [
  activeClass(to),
  "group flex items-center gap-x-3 rounded-xl px-3 py-2 text-sm font-medium leading-6 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/80 motion-reduce:transition-none",
];

/** Icon-only nav link — used in collapsed desktop sidebar. */
const navLinkClassCollapsed = (to: string) => [
  activeClass(to),
  "flex items-center justify-center rounded-xl p-2.5 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/80 motion-reduce:transition-none",
];

// Avatar initials from email (first char, uppercased).
// Mobile sidebar drawer state; auto-close on navigation.
const mobileOpen = ref(false);
watch(() => route.path, () => (mobileOpen.value = false));

// Collapsible desktop sidebar — persisted so it survives page refreshes.
const sidebarCollapsed = ref(localStorage.getItem("sidebar-collapsed") === "true");
watch(sidebarCollapsed, (v) => localStorage.setItem("sidebar-collapsed", String(v)));
function toggleSidebar() { sidebarCollapsed.value = !sidebarCollapsed.value; }

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
      <Dialog class="relative z-50 lg:hidden" @close="mobileOpen = false">
        <TransitionChild
          as="template"
          enter="transition-opacity ease-linear duration-300"
          enter-from="opacity-0"
          enter-to="opacity-100"
          leave="transition-opacity ease-linear duration-300"
          leave-from="opacity-100"
          leave-to="opacity-0"
        >
          <div class="fixed inset-0 bg-neutral-900/80 backdrop-blur-sm" />
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
            <DialogPanel class="relative mr-16 flex w-full max-w-xs flex-1">
              <div class="absolute top-0 left-full flex w-16 justify-center pt-5">
                <button type="button" class="-m-2.5 p-2.5" @click="mobileOpen = false">
                  <span class="sr-only">Close sidebar</span>
                  <AppIcon :icon="XMarkIcon" class="size-6 text-white" aria-hidden="true" />
                </button>
              </div>
              <!-- Mobile sidebar body -->
              <div class="sidebar-glass flex grow flex-col overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden border-r px-4 pb-4">
                <div class="flex h-16 shrink-0 items-center gap-x-3 border-b border-white/[0.08] px-1">
                  <AppLogo class="size-8 shrink-0" :dark="true" />
                  <img src="/logo-wordmark.png" alt="FuelGuard" class="h-5 object-contain brightness-0 invert" draggable="false" />
                </div>
                <nav aria-label="Primary navigation" class="flex flex-1 flex-col pt-3">
                  <ul role="list" class="flex flex-1 flex-col gap-y-0.5">
                    <template v-for="group in navGroups" :key="group.label ?? '_top'">
                      <li
                        v-if="group.label"
                        class="mb-1 mt-5 px-3 text-xs font-semibold uppercase tracking-wider text-neutral-500 first:mt-2"
                      >
                        {{ group.label }}
                      </li>
                      <li v-for="item in group.items" :key="item.name">
                        <RouterLink
                          :to="item.to"
                          :class="navLinkClass(item.to)"
                          :aria-current="isCurrent(item.to) ? 'page' : undefined"
                        >
                          <AppIcon :icon="item.icon" class="size-5 shrink-0" aria-hidden="true" />
                          <span class="flex-1">{{ item.name }}</span>
                          <span v-if="item.badge" class="rounded-full bg-brand-600 px-1.5 py-0.5 text-xs font-semibold text-ink-inverse">{{ item.badge }}</span>
                        </RouterLink>
                      </li>
                    </template>
                  </ul>
                </nav>
                <!-- Account menu at the bottom of the mobile drawer. -->
                <div class="mt-4 border-t border-white/[0.08] pt-3">
                  <SidebarProfileMenu
                    :email="session.email"
                    :role="session.role"
                    :can-manage="session.canManage"
                    @sign-out="signOut"
                  />
                </div>
              </div>
            </DialogPanel>
          </TransitionChild>
        </div>
      </Dialog>
    </TransitionRoot>

    <!-- ── Desktop sidebar (lg+, fixed, collapsible) ─────────────────────── -->
    <div
      class="hidden lg:fixed lg:inset-y-0 lg:z-50 lg:flex lg:flex-col transition-[width] duration-300 ease-out motion-reduce:transition-none"
      :class="sidebarCollapsed ? 'lg:w-16' : 'lg:w-64'"
    >
      <div class="sidebar-glass relative flex grow flex-col overflow-x-hidden border-r">
        <!-- Sidebar header -->
        <div
          class="flex h-16 shrink-0 items-center border-b border-white/[0.08]"
          :class="sidebarCollapsed ? 'justify-center px-2' : 'gap-x-3 px-5'"
        >
          <AppLogo class="size-8 shrink-0" :dark="true" />
          <img v-if="!sidebarCollapsed" src="/logo-wordmark.png" alt="FuelGuard" class="h-5 object-contain brightness-0 invert" draggable="false" />
        </div>

        <!-- Nav -->
        <nav id="desktop-sidebar-navigation" aria-label="Primary navigation" class="flex flex-1 min-h-0 flex-col overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden pt-3" :class="sidebarCollapsed ? 'px-2' : 'px-4'">
          <!-- Expanded: grouped section labels + full links -->
          <ul v-if="!sidebarCollapsed" role="list" class="flex flex-1 flex-col gap-y-0.5">
            <template v-for="group in navGroups" :key="group.label ?? '_top'">
              <li
                v-if="group.label"
                class="mb-1 mt-5 px-3 text-xs font-semibold uppercase tracking-wider text-neutral-500"
              >
                {{ group.label }}
              </li>
              <li v-for="item in group.items" :key="item.name">
                <RouterLink
                  :to="item.to"
                  :class="navLinkClass(item.to)"
                  :aria-current="isCurrent(item.to) ? 'page' : undefined"
                >
                  <AppIcon :icon="item.icon" class="size-5 shrink-0" aria-hidden="true" />
                  <span class="flex-1">{{ item.name }}</span>
                  <span v-if="item.badge" class="rounded-full bg-brand-600 px-1.5 py-0.5 text-xs font-semibold text-ink-inverse">{{ item.badge }}</span>
                </RouterLink>
              </li>
            </template>
          </ul>
          <!-- Collapsed: ungrouped items as icons; each labeled section opens a flyout submenu on hover/click -->
          <ul v-else role="list" class="flex flex-1 flex-col gap-y-1">
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
          class="mt-2 shrink-0 border-t border-white/[0.08] py-3"
          :class="sidebarCollapsed ? 'px-2' : 'px-3'"
        >
          <SidebarProfileMenu
            :email="session.email"
            :role="session.role"
            :collapsed="sidebarCollapsed"
            :can-manage="session.canManage"
            @sign-out="signOut"
          />
        </div>

      </div>

    </div>

    <!-- ── Main content area ─────────────────────────────────────────────── -->
    <div class="transition-[padding] duration-300 ease-out motion-reduce:transition-none" :class="sidebarCollapsed ? 'lg:pl-16' : 'lg:pl-64'">
      <!-- Sticky header ensures the hamburger toggle is always reachable on mobile. -->
      <header
        class="sticky top-0 z-40 flex h-16 shrink-0 items-center justify-between gap-x-4 border-b border-edge bg-surface px-4 shadow-sm sm:px-6 lg:px-8"
      >
        <div class="flex items-center gap-x-3">
          <button
            type="button"
            class="-m-2.5 p-2.5 text-ink-secondary lg:hidden"
            @click="mobileOpen = true"
          >
            <span class="sr-only">Open sidebar</span>
            <AppIcon :icon="Bars3Icon" class="size-6" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="-ml-2 hidden size-9 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 lg:inline-flex"
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
          <span class="hidden h-5 w-px bg-edge lg:block" aria-hidden="true" />
          <RouterLink
            v-if="route.meta.parent"
            :to="(route.meta.parent as string)"
            class="-ml-1 inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-ink-muted hover:bg-surface-muted hover:text-ink-secondary"
          >
            <AppIcon :icon="ChevronLeftIcon" class="size-4" aria-hidden="true" />
            <span class="hidden sm:inline">Back</span>
          </RouterLink>
          <h1 class="text-base font-semibold text-ink">
            {{ (route.meta.title as string) ?? "FuelGuard" }}
          </h1>
        </div>
        <div class="flex items-center gap-x-4">
          <span class="hidden text-sm text-ink-muted sm:inline">
            {{ session.email }}
            <span v-if="session.role" class="ml-1 capitalize text-ink-subtle">· {{ session.role }}</span>
          </span>
          <button
            type="button"
            class="rounded-md bg-surface-muted px-3 py-1.5 text-sm font-medium text-ink-secondary transition-colors hover:bg-neutral-200"
            @click="signOut"
          >
            Sign out
          </button>
        </div>
      </header>
      <main class="py-8">
        <!-- Full-width content: tables use the whole screen; small gutters only. -->
        <div class="w-full px-4 sm:px-6 lg:px-8">
          <slot />
        </div>
      </main>
    </div>
  </div>
</template>
