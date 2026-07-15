<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { useQueryClient } from "@tanstack/vue-query";
import { Dialog, DialogPanel, TransitionRoot, TransitionChild } from "@headlessui/vue";
import {
  HomeIcon,
  TruckIcon,
  UserGroupIcon,
  BeakerIcon,
  ExclamationTriangleIcon,
  ChartBarIcon,
  Cog6ToothIcon,
  UsersIcon,
  ArrowUpTrayIcon,
  TableCellsIcon,
  NoSymbolIcon,
  SparklesIcon,
  Bars3Icon,
  XMarkIcon,
  ChevronLeftIcon,
  CubeIcon,
  ArchiveBoxIcon,
  ArrowsRightLeftIcon,
  SignalIcon,
  ClipboardDocumentCheckIcon,
  ClockIcon,
  TrophyIcon,
  MapIcon,
  BuildingStorefrontIcon,
} from "@heroicons/vue/24/outline";
import type { FunctionalComponent } from "vue";
import { useSessionStore } from "@/stores/session";
import AppLogo from "@/components/AppLogo.vue";

interface NavItem {
  name: string;
  to: string;
  icon: FunctionalComponent;
  show: boolean;
}

interface NavGroup {
  label: string | null;
  items: NavItem[];
}

const session = useSessionStore();
const route = useRoute();
const router = useRouter();
const queryClient = useQueryClient();

// Role-aware navigation grouped by category. UI gating only — RLS + API are the real enforcement.
const navGroups = computed<NavGroup[]>(() =>
  [
    {
      label: null,
      items: [
        { name: "Dashboard", to: "/", icon: HomeIcon, show: true },
        { name: "Fuel Log", to: "/fuel-log", icon: BeakerIcon, show: true },
      ],
    },
    {
      label: "Data",
      items: [
        { name: "Import", to: "/import", icon: ArrowUpTrayIcon, show: session.canManage },
        { name: "Transactions", to: "/transactions", icon: TableCellsIcon, show: session.canManage || session.readOnly },
        { name: "Rejections", to: "/rejections", icon: NoSymbolIcon, show: session.canManage || session.readOnly },
      ],
    },
    {
      label: "Fleet",
      items: [
        { name: "Vehicles", to: "/vehicles", icon: TruckIcon, show: session.canManage || session.readOnly },
        { name: "Trailers", to: "/trailers", icon: ArchiveBoxIcon, show: session.canManage || session.readOnly },
        { name: "Drivers", to: "/drivers", icon: UserGroupIcon, show: session.canManage || session.readOnly },
        { name: "Odometer", to: "/odometer", icon: ArrowsRightLeftIcon, show: session.canManage || session.readOnly },
      ],
    },
    {
      label: "Analysis",
      items: [
        { name: "Alerts", to: "/anomalies", icon: ExclamationTriangleIcon, show: session.canManage || session.readOnly },
        { name: "Reefer Coverage", to: "/reefer-coverage", icon: CubeIcon, show: session.canManage || session.readOnly },
        { name: "Idling", to: "/idling", icon: ClockIcon, show: session.canManage || session.readOnly },
        { name: "Driver Performance", to: "/driver-performance", icon: TrophyIcon, show: session.canManage || session.readOnly },
        { name: "Fuel Planning", to: "/fuel-planning", icon: MapIcon, show: session.canManage },
        { name: "Truck Stops", to: "/truck-stops", icon: BuildingStorefrontIcon, show: session.canManage || session.readOnly },
        { name: "Ask AI", to: "/ask", icon: SparklesIcon, show: session.canManage || session.readOnly },
        { name: "Reports", to: "/reports", icon: ChartBarIcon, show: session.canManage || session.readOnly },
      ],
    },
    {
      label: "Admin",
      items: [
        { name: "Settings", to: "/settings", icon: Cog6ToothIcon, show: session.canManage },
        { name: "Detection Coverage", to: "/coverage", icon: SignalIcon, show: session.canManage || session.readOnly },
        { name: "Recall Audit", to: "/recall-audit", icon: ClipboardDocumentCheckIcon, show: session.canManage || session.readOnly },
        { name: "Users", to: "/settings/users", icon: UsersIcon, show: session.admin },
      ],
    },
  ]
    .map((g) => ({ ...g, items: g.items.filter((i) => i.show) }))
    .filter((g) => g.items.length > 0),
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
    ? "bg-brand-500/10 text-brand-300"
    : "text-neutral-400 hover:bg-white/5 hover:text-neutral-200";

/** Full expanded nav link — used in mobile drawer and expanded desktop sidebar. */
const navLinkClass = (to: string) => [
  activeClass(to),
  "group flex items-center gap-x-3 rounded-lg px-3 py-2 text-sm font-medium leading-6 transition-colors duration-150",
];

/** Icon-only nav link — used in collapsed desktop sidebar. */
const navLinkClassCollapsed = (to: string) => [
  activeClass(to),
  "flex items-center justify-center rounded-lg p-2.5 transition-colors duration-150",
];

// Avatar initials from email (first char, uppercased).
const avatarLetter = computed(() => (session.email ?? "?")[0]?.toUpperCase() ?? "?");

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
                  <XMarkIcon class="size-6 text-white" aria-hidden="true" />
                </button>
              </div>
              <!-- Mobile sidebar body -->
              <div class="flex grow flex-col overflow-y-auto bg-neutral-900 px-4 pb-4">
                <div class="flex h-16 shrink-0 items-center gap-x-3 border-b border-neutral-800/70 px-1">
                  <AppLogo class="size-8 shrink-0" :dark="true" />
                  <img src="/logo-wordmark.png" alt="FuelGuard" class="h-5 object-contain brightness-0 invert" draggable="false" />
                </div>
                <nav class="flex flex-1 flex-col pt-3">
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
                          <component :is="item.icon" class="size-5 shrink-0" aria-hidden="true" />
                          {{ item.name }}
                        </RouterLink>
                      </li>
                    </template>
                  </ul>
                </nav>
                <!-- User card at the bottom of mobile drawer -->
                <div class="mt-4">
                  <div class="flex items-center gap-x-3 rounded-xl bg-neutral-800/60 px-3 py-3 ring-1 ring-inset ring-white/5">
                    <div
                      class="flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-xs font-bold text-white shadow"
                      aria-hidden="true"
                    >
                      {{ avatarLetter }}
                    </div>
                    <div class="min-w-0 flex-1">
                      <p class="truncate text-xs font-semibold text-white">{{ session.email }}</p>
                      <p v-if="session.role" class="mt-0.5 text-xs capitalize text-neutral-400">{{ session.role }}</p>
                    </div>
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
      class="hidden lg:fixed lg:inset-y-0 lg:z-50 lg:flex lg:flex-col transition-all duration-200 ease-in-out"
      :class="sidebarCollapsed ? 'lg:w-16' : 'lg:w-64'"
    >
      <div class="flex grow flex-col overflow-x-hidden border-r border-neutral-800/50 bg-neutral-900">
        <!-- Sidebar header -->
        <div
          class="flex h-16 shrink-0 items-center border-b border-neutral-800/70"
          :class="sidebarCollapsed ? 'justify-center px-2' : 'gap-x-3 px-5'"
        >
          <AppLogo class="size-8 shrink-0" :dark="true" />
          <img v-if="!sidebarCollapsed" src="/logo-wordmark.png" alt="FuelGuard" class="h-5 object-contain brightness-0 invert" draggable="false" />
        </div>

        <!-- Nav -->
        <nav class="flex flex-1 min-h-0 flex-col overflow-y-auto pt-3" :class="sidebarCollapsed ? 'px-2' : 'px-4'">
          <ul role="list" class="flex flex-1 flex-col gap-y-0.5">
            <template v-for="group in navGroups" :key="group.label ?? '_top'">
              <li
                v-if="group.label && !sidebarCollapsed"
                class="mb-1 mt-5 px-3 text-xs font-semibold uppercase tracking-wider text-neutral-500"
              >
                {{ group.label }}
              </li>
              <li v-else-if="group.label" class="mt-3" />
              <li v-for="item in group.items" :key="item.name">
                <RouterLink
                  :to="item.to"
                  :class="sidebarCollapsed ? navLinkClassCollapsed(item.to) : navLinkClass(item.to)"
                  :title="sidebarCollapsed ? item.name : undefined"
                  :aria-current="isCurrent(item.to) ? 'page' : undefined"
                >
                  <component :is="item.icon" class="size-5 shrink-0" aria-hidden="true" />
                  <span v-if="!sidebarCollapsed">{{ item.name }}</span>
                </RouterLink>
              </li>
            </template>
          </ul>
        </nav>

        <!-- User card -->
        <div class="mt-2 shrink-0 pb-3" :class="sidebarCollapsed ? 'px-2' : 'px-4'">
          <!-- Collapsed: avatar only -->
          <div v-if="sidebarCollapsed" class="flex justify-center py-2">
            <div
              class="flex size-9 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-xs font-bold text-white shadow"
              :title="session.email ?? undefined"
            >
              {{ avatarLetter }}
            </div>
          </div>
          <!-- Expanded: avatar + email/role -->
          <div v-else class="flex items-center gap-x-3 rounded-xl bg-neutral-800/60 px-3 py-3 ring-1 ring-inset ring-white/5">
            <div
              class="flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-xs font-bold text-white shadow"
              aria-hidden="true"
            >
              {{ avatarLetter }}
            </div>
            <div class="min-w-0 flex-1">
              <p class="truncate text-xs font-semibold text-white">{{ session.email }}</p>
              <p v-if="session.role" class="mt-0.5 text-xs capitalize text-neutral-400">{{ session.role }}</p>
            </div>
          </div>
        </div>

      </div>

      <!-- Modern floating edge toggle -->
      <button
        type="button"
        class="absolute right-0 top-8 z-10 flex size-5 translate-x-1/2 cursor-pointer items-center justify-center rounded-full border border-neutral-700 bg-neutral-900 text-neutral-400 shadow-md transition-all duration-200 hover:scale-110 hover:border-brand-500 hover:bg-brand-600 hover:text-white hover:shadow-brand-500/25"
        :title="sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'"
        @click="toggleSidebar"
      >
        <ChevronLeftIcon
          class="size-3 transition-transform duration-200"
          :class="{ 'rotate-180': sidebarCollapsed }"
          aria-hidden="true"
        />
      </button>
    </div>

    <!-- ── Main content area ─────────────────────────────────────────────── -->
    <div class="transition-all duration-200 ease-in-out" :class="sidebarCollapsed ? 'lg:pl-16' : 'lg:pl-64'">
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
            <Bars3Icon class="size-6" aria-hidden="true" />
          </button>
          <RouterLink
            v-if="route.meta.parent"
            :to="(route.meta.parent as string)"
            class="-ml-1 inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-ink-muted hover:bg-surface-muted hover:text-ink-secondary"
          >
            <ChevronLeftIcon class="size-4" aria-hidden="true" />
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
