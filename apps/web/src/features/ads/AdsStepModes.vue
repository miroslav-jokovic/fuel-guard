<script setup lang="ts">
import { computed } from "vue";
import { AD_STEPS, modeOpen, type AdMode } from "@silvicom/shared";
import { AppCard as BaseCard, QueryState } from "@silvicom/ui";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { useAdsSettings } from "./useAdsSettings";

/**
 * Ads › Automation's "Who does each step" (V5 part 4; Q-APX21 (a)). Every row is the shared step table (`AD_STEPS`)
 * and the carrier's saved settings, read here and never restated: the mode in force, what happens in it, and each
 * other mode — open, with where it is changed, or locked, with what opens it. A locked mode is locked by the authority
 * table (`modeOpen`), so this screen cannot show a mode the code would not run. Changing a mode is Settings' (one
 * save of the whole settings, an admin's, behind a fresh sign-in); the link is shown to whoever may open Settings.
 */
defineProps<{ canOpenSettings: boolean }>();
const settings = useAdsSettings();

const MODE_LABEL: Record<AdMode, string> = { manual: "Manual", assisted: "Assisted", autopilot: "Autopilot" };

const rows = computed(() => {
  const s = settings.data.value?.settings;
  if (!s) return [];
  return AD_STEPS.map((step) => {
    const now = step.modeIn(s);
    const inForce = step.modes.find((m) => m.mode === now)!;
    const others = step.modes.filter((m) => m.mode !== now).map((m) => ({ mode: m.mode, open: modeOpen(m), opens_when: m.opens_when ?? null, said: m.said }));
    return { key: step.key, label: step.label, mode: now, said: inForce.said, others };
  });
});
</script>

<template>
  <BaseCard as="section" class="space-y-3" data-test="step-modes">
    <h2 class="text-sm font-semibold text-ink">Who does each step</h2>
    <QueryState :loading="settings.isLoading.value" :error="settings.error.value" error-text="Could not load the ads settings." :retrying="settings.isFetching.value" @retry="settings.refetch()">
      <ul class="divide-y divide-edge-subtle">
        <li v-for="r in rows" :key="r.key" class="space-y-1 py-3" :data-step="r.key">
          <p class="text-sm font-medium text-ink">
            {{ r.label }}
            <span :class="[BADGE_BASE, toneClass(r.mode === 'manual' ? 'neutral' : 'info'), 'ml-2']" data-test="mode">{{ MODE_LABEL[r.mode] }}</span>
          </p>
          <p class="text-sm text-ink-muted">{{ r.said }}</p>
          <p v-for="o in r.others" :key="o.mode" class="text-xs text-ink-muted" :data-test="`other-${o.mode}`">
            <template v-if="o.open">{{ MODE_LABEL[o.mode] }} is available: {{ o.said }}<RouterLink v-if="canOpenSettings" to="/ads/settings" class="ml-1 font-medium text-ink hover:underline">Change in Settings</RouterLink></template>
            <template v-else>{{ MODE_LABEL[o.mode] }} is locked. {{ o.opens_when }}</template>
          </p>
        </li>
      </ul>
    </QueryState>
  </BaseCard>
</template>
