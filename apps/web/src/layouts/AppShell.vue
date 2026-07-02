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
  FireIcon,
  SparklesIcon,
  Bars3Icon,
  XMarkIcon,
  ArrowLeftOnRectangleIcon,
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
        { name: "Drivers", to: "/drivers", icon: UserGroupIcon, show: session.canManage || session.readOnly },
      ],
    },
    {
      label: "Analysis",
      items: [
        { name: "Anomalies", to: "/anomalies", icon: ExclamationTriangleIcon, show: session.canManage || session.readOnly },
        { name: "Fuel Events", to: "/fuel-events", icon: FireIcon, show: session.canManage || session.readOnly },
        { name: "Ask AI", to: "/ask", icon: SparklesIcon, show: session.canManage || session.readOnly },
        { name: "Reports", to: "/reports", icon: ChartBarIcon, show: session.canManage || session.readOnly },
      ],
    },
    {
      label: "Admin",
      items: [
        { name: "Settings", to: "/settings", icon: Cog6ToothIcon, show: session.canManage },
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

const navLinkClass = (to: string) => [
  isCurrent(to)
    ? "bg-indigo-500/10 text-indigo-300"
    : "text-gray-400 hover:bg-white/5 hover:text-gray-200",
  "group flex items-center gap-x-3 rounded-lg px-3 py-2 text-sm font-medium leading-6 transition-colors duration-150",
];

// Avatar initials from email (first char, uppercased).
const avatarLetter = computed(() => (session.email ?? "?")[0]?.toUpperCase() ?? "?");

// Mobile sidebar drawer state; auto-close on navigation.
const mobileOpen = ref(false);
watch(() => route.path, () => (mobileOpen.value = false));

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
          <div class="fixed inset-0 bg-gray-900/80 backdrop-blur-sm" />
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
              <div class="flex grow flex-col overflow-y-auto bg-gray-900 px-4 pb-4">
                <div class="flex h-16 shrink-0 items-center gap-x-3 border-b border-gray-800/70 px-1">
                  <AppLogo class="size-8 shrink-0" />
                  <span class="text-base font-semibold tracking-tight text-white">FuelGuard</span>
                </div>
                <nav class="flex flex-1 flex-col pt-3">
                  <ul role="list" class="flex flex-1 flex-col gap-y-0.5">
                    <template v-for="group in navGroups" :key="group.label ?? '_top'">
                      <li
                        v-if="group.label"
                        class="mb-1 mt-5 px-3 text-xs font-semibold uppercase tracking-wider text-gray-500 first:mt-2"
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
                  <div class="flex items-center gap-x-3 rounded-xl bg-gray-800/60 px-3 py-3 ring-1 ring-inset ring-white/5">
                    <div
                      class="flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-xs font-bold text-white shadow"
                      aria-hidden="true"
                    >
                      {{ avatarLetter }}
                    </div>
                    <div class="min-w-0 flex-1">
                      <p class="truncate text-xs font-semibold text-white">{{ session.email }}</p>
                      <p v-if="session.role" class="mt-0.5 text-xs capitalize text-gray-400">{{ session.role }}</p>
                    </div>
                    <button
                      type="button"
                      class="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-700 hover:text-white"
                      title="Sign out"
                      @click="signOut"
                    >
                      <ArrowLeftOnRectangleIcon class="size-4" aria-hidden="true" />
                      <span class="sr-only">Sign out</span>
                    </button>
                  </div>
                </div>
              </div>
            </DialogPanel>
          </TransitionChild>
        </div>
      </Dialog>
    </TransitionRoot>

    <!-- ── Desktop sidebar (lg+, fixed) ─────────────────────────────────── -->
    <div class="hidden lg:fixed lg:inset-y-0 lg:z-50 lg:flex lg:w-64 lg:flex-col">
      <div class="flex grow flex-col overflow-y-auto border-r border-gray-800/50 bg-gray-900 px-4 pb-4">
        <div class="flex h-16 shrink-0 items-center gap-x-3 border-b border-gray-800/70 px-1">
          <AppLogo class="size-8 shrink-0" />
          <span class="text-base font-semibold tracking-tight text-white">FuelGuard</span>
        </div>
        <nav class="flex flex-1 flex-col pt-3">
          <ul role="list" class="flex flex-1 flex-col gap-y-0.5">
            <template v-for="group in navGroups" :key="group.label ?? '_top'">
              <li
                v-if="group.label"
                class="mb-1 mt-5 px-3 text-xs font-semibold uppercase tracking-wider text-gray-500"
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
        <!-- User card at the bottom of the desktop sidebar -->
        <div class="mt-4">
          <div class="flex items-center gap-x-3 rounded-xl bg-gray-800/60 px-3 py-3 ring-1 ring-inset ring-white/5">
            <div
              class="flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-xs font-bold text-white shadow"
              aria-hidden="true"
            >
              {{ avatarLetter }}
            </div>
            <div class="min-w-0 flex-1">
              <p class="truncate text-xs font-semibold text-white">{{ session.email }}</p>
              <p v-if="session.role" class="mt-0.5 text-xs capitalize text-gray-400">{{ session.role }}</p>
            </div>
            <button
              type="button"
              class="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-700 hover:text-white"
              title="Sign out"
              @click="signOut"
            >
              <ArrowLeftOnRectangleIcon class="size-4" aria-hidden="true" />
              <span class="sr-only">Sign out</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Main content area ─────────────────────────────────────────────── -->
    <div class="lg:pl-64">
      <!-- Sticky header ensures the hamburger toggle is always reachable on mobile. -->
      <header
        class="sticky top-0 z-40 flex h-16 shrink-0 items-center justify-between gap-x-4 border-b border-gray-200 bg-white px-4 shadow-sm sm:px-6 lg:px-8"
      >
        <div class="flex items-center gap-x-3">
          <button
            type="button"
            class="-m-2.5 p-2.5 text-gray-700 lg:hidden"
            @click="mobileOpen = true"
          >
            <span class="sr-only">Open sidebar</span>
            <Bars3Icon class="size-6" aria-hidden="true" />
          </button>
          <h1 class="text-base font-semibold text-gray-900">
            {{ (route.meta.title as string) ?? "FuelGuard" }}
          </h1>
        </div>
        <div class="flex items-center gap-x-4">
          <span class="hidden text-sm text-gray-500 sm:inline">
            {{ session.email }}
            <span v-if="session.role" class="ml-1 capitalize text-gray-400">· {{ session.role }}</span>
          </span>
          <button
            type="button"
            class="rounded-md bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200"
            @click="signOut"
          >
            Sign out
          </button>
        </div>
      </header>
      <main class="py-8">
        <div class="mx-auto max-w-[1600px] px-4 sm:px-6 lg:px-8">
          <slot />
        </div>
      </main>
    </div>
  </div>
</template>
