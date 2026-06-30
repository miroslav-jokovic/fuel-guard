<script setup lang="ts">
import { computed } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
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
} from "@heroicons/vue/24/outline";
import type { FunctionalComponent } from "vue";
import { useSessionStore } from "@/stores/session";

interface NavItem {
  name: string;
  to: string;
  icon: FunctionalComponent;
  show: boolean;
}

const session = useSessionStore();
const route = useRoute();
const router = useRouter();

// Role-aware navigation (PRD §2): drivers get Dashboard + Fuel Log; managers/admin/auditor see all;
// Users is admin-only. UI gating only — RLS + API are the real enforcement.
const navigation = computed<NavItem[]>(() =>
  [
    { name: "Dashboard", to: "/", icon: HomeIcon, show: true },
    { name: "Fuel Log", to: "/fuel-log", icon: BeakerIcon, show: true },
    { name: "Import", to: "/import", icon: ArrowUpTrayIcon, show: session.canManage },
    { name: "Vehicles", to: "/vehicles", icon: TruckIcon, show: session.canManage || session.readOnly },
    { name: "Drivers", to: "/drivers", icon: UserGroupIcon, show: session.canManage || session.readOnly },
    {
      name: "Anomalies",
      to: "/anomalies",
      icon: ExclamationTriangleIcon,
      show: session.canManage || session.readOnly,
    },
    { name: "Reports", to: "/reports", icon: ChartBarIcon, show: session.canManage || session.readOnly },
    { name: "Settings", to: "/settings", icon: Cog6ToothIcon, show: session.canManage },
    { name: "Users", to: "/settings/users", icon: UsersIcon, show: session.admin },
  ].filter((i) => i.show),
);

const isCurrent = (to: string) => (to === "/" ? route.path === "/" : route.path.startsWith(to));

async function signOut() {
  await session.signOut();
  router.push("/login");
}
</script>

<template>
  <div class="min-h-full">
    <div class="hidden lg:fixed lg:inset-y-0 lg:z-50 lg:flex lg:w-64 lg:flex-col">
      <div class="flex grow flex-col gap-y-5 overflow-y-auto bg-gray-900 px-6 pb-4">
        <div class="flex h-16 shrink-0 items-center gap-x-3">
          <span
            class="flex size-9 items-center justify-center rounded-lg bg-indigo-500 text-sm font-bold text-white"
            >FG</span
          >
          <span class="text-lg font-semibold text-white">FleetGuard</span>
        </div>
        <nav class="flex flex-1 flex-col">
          <ul role="list" class="flex flex-1 flex-col gap-y-7">
            <li>
              <ul role="list" class="-mx-2 space-y-1">
                <li v-for="item in navigation" :key="item.name">
                  <RouterLink
                    :to="item.to"
                    :class="[
                      isCurrent(item.to)
                        ? 'bg-gray-800 text-white'
                        : 'text-gray-400 hover:bg-gray-800 hover:text-white',
                      'group flex gap-x-3 rounded-md p-2 text-sm font-semibold',
                    ]"
                  >
                    <component :is="item.icon" class="size-6 shrink-0" aria-hidden="true" />
                    {{ item.name }}
                  </RouterLink>
                </li>
              </ul>
            </li>
          </ul>
        </nav>
      </div>
    </div>

    <div class="lg:pl-64">
      <header
        class="flex h-16 shrink-0 items-center justify-between gap-x-4 border-b border-gray-200 bg-white px-4 shadow-sm sm:px-6 lg:px-8"
      >
        <h1 class="text-base font-semibold text-gray-900">
          {{ (route.meta.title as string) ?? "FleetGuard" }}
        </h1>
        <div class="flex items-center gap-x-4">
          <span class="hidden text-sm text-gray-500 sm:inline">
            {{ session.email }}
            <span v-if="session.role" class="ml-1 text-gray-400">· {{ session.role }}</span>
          </span>
          <button
            class="rounded-md bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200"
            @click="signOut"
          >
            Sign out
          </button>
        </div>
      </header>
      <main class="py-8">
        <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <slot />
        </div>
      </main>
    </div>
  </div>
</template>
