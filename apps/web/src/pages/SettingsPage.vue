<script setup lang="ts">
import { AppIcon } from "@silvicom/ui";
import { SURFACES, surfaceAllowed } from "@silvicom/shared";
import { RouterLink } from "vue-router";
import FleetReadiness from "@/features/dashboard/FleetReadiness.vue";
import { SETTINGS_CARDS } from "@/lib/settingsCards";
import { useSessionStore } from "@/stores/session";
import PageHeader from "@/components/ui/PageHeader.vue";
import SettingsSection from "@/components/ui/SettingsSection.vue";

const session = useSessionStore();

/**
 * A card shows exactly when its screen opens (SP1): the same `surfaceAllowed` the router guard asks,
 * over the same role, section claim and screen claim. Until SP1 each card wrote its own expression
 * — nine of them `session.admin` — which is why none of those nine could be offered as a permission.
 * The name and the path come from the catalogue too, so a card cannot link somewhere its label does
 * not describe. `lib/settingsCards.ts` holds only what a card looks like.
 */
const visible = SETTINGS_CARDS.flatMap((c) => {
  const s = SURFACES.find((x) => x.key === c.key);
  if (!s || !surfaceAllowed(s, session.role, session.sections, session.surfaces)) return [];
  return [{ name: s.label, to: s.path, icon: c.icon, desc: c.desc, block: c.block }];
});
const configCards = visible.filter((c) => c.block === "config");
const reportCards = visible.filter((c) => c.block === "reports");
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
