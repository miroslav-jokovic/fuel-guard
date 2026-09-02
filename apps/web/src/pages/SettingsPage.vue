<script setup lang="ts">
import { AppIcon } from "@silvicom/ui";
import {
  AdjustmentsHorizontalIcon,
  BellIcon,
  BuildingOffice2Icon,
  ClipboardDocumentCheckIcon,
  ClipboardDocumentListIcon,
  ConnectIcon,
  LockIcon,
  DatabaseSyncIcon,
  DevicePhoneMobileIcon,
  MapIcon,
  RadarIcon,
  ReeferTruckIcon,
  ReportChartIcon,
  UsersIcon,
} from "@silvicom/ui/icons";
import { RouterLink } from "vue-router";
import FleetReadiness from "@/features/dashboard/FleetReadiness.vue";
import { useSessionStore } from "@/stores/session";
import PageHeader from "@/components/ui/PageHeader.vue";
import SettingsSection from "@/components/ui/SettingsSection.vue";

const session = useSessionStore();
const manageOrRead = session.can("settings") || session.readOnly;

// Configuration surfaces (org, users, tuning).
const configCards = [
  { name: "Organization", to: "/settings/org", icon: BuildingOffice2Icon, desc: "Profile, allowed domains, and operating hours.", show: session.admin },
  { name: "Notifications", to: "/settings/notifications", icon: BellIcon, desc: "Who gets emailed when high/critical anomalies are detected.", show: session.admin },
  { name: "Users", to: "/settings/users", icon: UsersIcon, desc: "Invite teammates and manage roles.", show: session.admin },
  { name: "Permissions", to: "/settings/permissions", icon: LockIcon, desc: "What each role can reach, and exactly what a given member sees.", show: session.admin },
  // `roster` and not `settings`: this console decides what DRIVERS see, its route requires the same
  // section, and driverAppSettings.ts gates on rolesThatManage("roster"). The card, the route and the
  // endpoint now ask one question — before R0 all three asked the same global boolean and agreed by
  // accident rather than by construction.
  { name: "Driver App", to: "/settings/driver-app", icon: DevicePhoneMobileIcon, desc: "Which features drivers see, app behavior, per-driver exceptions, and the minimum app version.", show: session.can("roster") },
  { name: "Data & sync", to: "/settings/data", icon: DatabaseSyncIcon, desc: "Samsara sync, re-sync, rebuild anomalies, and data-integrity status.", show: session.can("settings") },
  { name: "EFS integration", to: "/settings/efs-soap", icon: ConnectIcon, desc: "SOAP credentials, connection test, and per-feed sync for the direct EFS webservice.", show: session.admin },
  { name: "Card control", to: "/settings/card-control", icon: LockIcon, desc: "Who may lock cards and grant fuel exceptions, and the EFS write-access check.", show: session.admin },
  { name: "Anomaly thresholds", to: "/settings/thresholds", icon: AdjustmentsHorizontalIcon, desc: "Tune the detection engine and AI settings.", show: session.admin },
  { name: "Planned fueling", to: "/settings/fuel-planning", icon: MapIcon, desc: "Reserves, corridor width, price freshness, brand policy, and the default truck profile.", show: session.admin },
  { name: "Audit log", to: "/settings/audit", icon: ClipboardDocumentListIcon, desc: "Who did what, and when.", show: session.admin || session.readOnly },
].filter((c) => c.show);

// Reporting & detection-health surfaces — moved off the daily sidebar into Settings.
const reportCards = [
  { name: "Reports", to: "/reports", icon: ReportChartIcon, desc: "Fuel spend, MPG, and anomaly summaries to review or export.", show: manageOrRead },
  { name: "Detection coverage", to: "/coverage", icon: RadarIcon, desc: "Which trucks and rules the anomaly engine can score today.", show: manageOrRead },
  { name: "Reefer coverage", to: "/reefer-coverage", icon: ReeferTruckIcon, desc: "Which trucks have reefer-fueling detection enabled.", show: manageOrRead },
  { name: "Recall audit", to: "/recall-audit", icon: ClipboardDocumentCheckIcon, desc: "Sampled review of how much the detection engine catches.", show: manageOrRead },
].filter((c) => c.show);
</script>

<template>
  <div class="space-y-8">
    <PageHeader description="Configuration, access, integrations, reporting, and fleet-readiness tools." />
    <SettingsSection v-if="configCards.length" title="Configuration">
      <div class="divide-y divide-edge-subtle rounded-surface bg-surface ring-1 ring-edge">
        <RouterLink
          v-for="c in configCards"
          :key="c.to"
          :to="c.to"
          class="flex items-start gap-4 p-4 hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus-ring"
        >
          <AppIcon :icon="c.icon" class="size-5 shrink-0 text-brand-accent-strong" aria-hidden="true" />
          <div>
            <h3 class="text-sm font-semibold text-ink">{{ c.name }}</h3>
            <p class="mt-1 text-sm text-ink-muted">{{ c.desc }}</p>
          </div>
        </RouterLink>
      </div>
    </SettingsSection>

    <SettingsSection
      v-if="session.can('settings')"
      title="Fleet readiness"
      description="Complete the fleet configuration required for reliable fuel and anomaly detection."
    >
      <FleetReadiness />
    </SettingsSection>

    <SettingsSection v-if="reportCards.length" title="Reports & detection health">
      <div class="divide-y divide-edge-subtle rounded-surface bg-surface ring-1 ring-edge">
        <RouterLink
          v-for="c in reportCards"
          :key="c.to"
          :to="c.to"
          class="flex items-start gap-4 p-4 hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus-ring"
        >
          <AppIcon :icon="c.icon" class="size-5 shrink-0 text-brand-accent-strong" aria-hidden="true" />
          <div>
            <h3 class="text-sm font-semibold text-ink">{{ c.name }}</h3>
            <p class="mt-1 text-sm text-ink-muted">{{ c.desc }}</p>
          </div>
        </RouterLink>
      </div>
    </SettingsSection>

    <p v-if="!configCards.length && !reportCards.length" class="text-sm text-ink-muted">No settings available for your role.</p>
  </div>
</template>
