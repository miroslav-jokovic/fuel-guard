<script setup lang="ts">
import { RouterLink } from "vue-router";
import { UsersIcon, AdjustmentsHorizontalIcon, BuildingOffice2Icon, ClipboardDocumentListIcon, ArrowPathIcon } from "@heroicons/vue/24/outline";
import { useSessionStore } from "@/stores/session";

const session = useSessionStore();

const cards = [
  { name: "Organization", to: "/settings/org", icon: BuildingOffice2Icon, desc: "Profile, operating hours, notification recipients.", show: session.admin },
  { name: "Users", to: "/settings/users", icon: UsersIcon, desc: "Invite teammates and manage roles.", show: session.admin },
  { name: "Data & sync", to: "/settings/data", icon: ArrowPathIcon, desc: "Samsara sync, re-sync, rebuild anomalies, and data-integrity status.", show: session.canManage },
  { name: "Anomaly thresholds", to: "/settings/thresholds", icon: AdjustmentsHorizontalIcon, desc: "Tune the detection engine and AI settings.", show: session.admin },
  { name: "Audit log", to: "/settings/audit", icon: ClipboardDocumentListIcon, desc: "Who did what, and when.", show: session.admin || session.readOnly },
].filter((c) => c.show);
</script>

<template>
  <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
    <RouterLink
      v-for="c in cards"
      :key="c.to"
      :to="c.to"
      class="flex items-start gap-4 rounded-lg bg-white p-5 shadow-sm ring-1 ring-gray-200 hover:ring-indigo-300"
    >
      <component :is="c.icon" class="size-6 shrink-0 text-indigo-500" aria-hidden="true" />
      <div>
        <h3 class="text-sm font-semibold text-gray-900">{{ c.name }}</h3>
        <p class="mt-1 text-sm text-gray-500">{{ c.desc }}</p>
      </div>
    </RouterLink>
    <p v-if="cards.length === 0" class="text-sm text-gray-500">No settings available for your role.</p>
  </div>
</template>
