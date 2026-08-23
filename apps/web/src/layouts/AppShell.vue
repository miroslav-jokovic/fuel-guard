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
import NotificationBell from "@/components/NotificationBell.vue";
import { useHazmatReviewCountQuery } from "@/features/hazmat/useHazmatReview";
import { useThreadsQuery } from "@/features/messages/useMessages";
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
// Messages unread for the nav badge (Phase 7) — same one-fetch-two-surfaces query the inbox uses.
const messagesVisible = computed(() =>
  canViewSection(session.role, "dispatch") && moduleEnabled(modules.data.value ?? null, "messages"),
);
const threadsQ = useThreadsQuery(messagesVisible);
const navGroups = computed<NavGroup[]>(() =>
  buildNavGroups(session.role, modules.data.value ?? null, {
    hazmatReview: reviewCount.data.value ?? 0,
    messagesUnread: threadsQ.data.value?.unread_total ?? 0,
  }),
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

/** Icon-only nav link — used in collapsed desktop sidebar. */
const navLinkClassCollapsed = (to: string) => [
  activeClass(to),
  "sidebar-nav-item flex min-h-9 items-center justify-center rounded-control p-2",
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
                  <div
                    class="sidebar-divider flex h-14 shrink-0 items-center gap-x-2.5 border-b px-1.5"
                  >
                    <AppLogo class="size-7 shrink-0" />
                    <img
                      src="/logo-wordmark.png"
                      alt="FuelGuard"
                      class="h-5 object-contain"
                      draggable="false"
                    />
                  </div>
                  <nav aria-label="Primary navigation" class="flex flex-1 flex-col pt-2">
                    <ul class="flex flex-1 flex-col gap-y-0.5">
                      <template v-for="group in navGroups" :key="group.label ?? '_top'">
                        <li
                          v-if="group.label"
                          class="sidebar-section-label mb-1 mt-4 px-2.5 text-xs font-medium first:mt-2"
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
                      :role="session.role"
                      :can-manage="session.canManage"
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
      class="hidden lg:fixed lg:inset-y-0 lg:z-50 lg:flex lg:flex-col transition-[width] duration-300 ease-out motion-reduce:transition-none"
      :class="sidebarCollapsed ? 'lg:w-[3.75rem]' : 'lg:w-[17rem]'"
    >
      <div class="sidebar-glass relative flex grow overflow-hidden border-r">
        <div class="sidebar-glass-material" aria-hidden="true" />
        <div class="sidebar-glass-content flex min-h-0 grow flex-col overflow-x-hidden">
          <!-- Sidebar header -->
          <div
            class="sidebar-divider flex h-14 shrink-0 items-center border-b"
            :class="sidebarCollapsed ? 'justify-center px-2' : 'gap-x-2.5 px-4'"
          >
            <AppLogo class="size-7 shrink-0" />
            <img
              v-if="!sidebarCollapsed"
              src="/logo-wordmark.png"
              alt="FuelGuard"
              class="h-5 object-contain"
              draggable="false"
            />
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
                <li
                  v-if="group.label"
                  class="sidebar-section-label mb-1 mt-4 px-2.5 text-xs font-medium"
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
              :role="session.role"
              :collapsed="sidebarCollapsed"
              :can-manage="session.canManage"
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
        class="sticky top-0 z-40 flex h-14 shrink-0 items-center border-b border-edge-subtle bg-canvas/95 px-4 backdrop-blur sm:px-6 lg:px-8"
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
        <div class="ml-auto flex items-center">
          <NotificationBell />
        </div>
      </header>
      <main class="py-6">
        <!-- Full-width content: tables use the whole screen; small gutters only. -->
        <div class="w-full px-4 sm:px-6 lg:px-8">
          <slot />
        </div>
      </main>
    </div>
  </div>
</template>
