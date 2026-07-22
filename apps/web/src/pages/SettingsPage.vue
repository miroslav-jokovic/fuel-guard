<script setup lang="ts">
import { RouterLink } from "vue-router";
import { UsersIcon, AdjustmentsHorizontalIcon, BuildingOffice2Icon, ClipboardDocumentListIcon, ArrowPathIcon, BellIcon, MapIcon, ChartBarIcon, SignalIcon, CubeIcon, ClipboardDocumentCheckIcon } from "@heroicons/vue/24/outline";
import { useSessionStore } from "@/stores/session";

const session = useSessionStore();
const manageOrRead = session.canManage || session.readOnly;

// Configuration surfaces (org, users, tuning).
const configCards = [
  { name: "Organization", to: "/settings/org", icon: BuildingOffice2Icon, desc: "Profile, allowed domains, and operating hours.", show: session.admin },
  { name: "Notifications", to: "/settings/notifications", icon: BellIcon, desc: "Who gets emailed when high/critical anomalies are detected.", show: session.admin },
  { name: "Users", to: "/settings/users", icon: UsersIcon, desc: "Invite teammates and manage roles.", show: session.admin },
  { name: "Data & sync", to: "/settings/data", icon: ArrowPathIcon, desc: "Samsara sync, re-sync, rebuild anomalies, and data-integrity status.", show: session.canManage },
  { name: "Anomaly thresholds", to: "/settings/thresholds", icon: AdjustmentsHorizontalIcon, desc: "Tune the detection engine and AI settings.", show: session.admin },
  { name: "Planned fueling", to: "/settings/fuel-planning", icon: MapIcon, desc: "Reserves, corridor width, price freshness, brand policy, and the default truck profile.", show: session.admin },
  { name: "Audit log", to: "/settings/audit", icon: ClipboardDocumentListIcon, desc: "Who did what, and when.", show: session.admin || session.readOnly },
].filter((c) => c.show);

// Reporting & detection-health surfaces — moved off the daily sidebar into Settings.
const reportCards = [
  { name: "Reports", to: "/reports", icon: ChartBarIcon, desc: "Fuel spend, MPG, and anomaly summaries to review or export.", show: manageOrRead },
  { name: "Detection coverage", to: "/coverage", icon: SignalIcon, desc: "Which trucks and rules the anomaly engine can score today.", show: manageOrRead },
  { name: "Reefer coverage", to: "/reefer-coverage", icon: CubeIcon, desc: "Which trucks have reefer-fueling detection enabled.", show: manageOrRead },
  { name: "Recall audit", to: "/recall-audit", icon: ClipboardDocumentCheckIcon, desc: "Sampled review of how much the detection engine catches.", show: manageOrRead },
].filter((c) => c.show);
</script>

<template>
  <div class="space-y-8">
    <section v-if="configCards.length" class="space-y-3">
      <h2 class="text-xs font-semibold uppercase tracking-wider text-ink-muted">Configuration</h2>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <RouterLink
          v-for="c in configCards"
          :key="c.to"
          :to="c.to"
          class="flex items-start gap-4 rounded-lg bg-surface p-5 shadow-sm ring-1 ring-edge hover:ring-brand-300"
        >
          <component :is="c.icon" class="size-6 shrink-0 text-brand-500" aria-hidden="true" />
          <div>
            <h3 class="text-sm font-semibold text-ink">{{ c.name }}</h3>
            <p class="mt-1 text-sm text-ink-muted">{{ c.desc }}</p>
          </div>
        </RouterLink>
      </div>
    </section>

    <section v-if="reportCards.length" class="space-y-3">
      <h2 class="text-xs font-semibold uppercase tracking-wider text-ink-muted">Reports &amp; detection health</h2>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <RouterLink
          v-for="c in reportCards"
          :key="c.to"
          :to="c.to"
          class="flex items-start gap-4 rounded-lg bg-surface p-5 shadow-sm ring-1 ring-edge hover:ring-brand-300"
        >
          <component :is="c.icon" class="size-6 shrink-0 text-brand-500" aria-hidden="true" />
          <div>
            <h3 class="text-sm font-semibold text-ink">{{ c.name }}</h3>
            <p class="mt-1 text-sm text-ink-muted">{{ c.desc }}</p>
          </div>
        </RouterLink>
      </div>
    </section>

    <p v-if="!configCards.length && !reportCards.length" class="text-sm text-ink-muted">No settings available for your role.</p>
  </div>
</template>
