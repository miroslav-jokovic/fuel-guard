<script setup lang="ts">
import { computed, ref } from "vue";
import type { AdPresetView } from "@silvicom/shared";
import { AppButton as BaseButton, AppCard as BaseCard, QueryState } from "@silvicom/ui";
import { formatDateTime } from "@/lib/format";
import { useSessionStore } from "@/stores/session";
import AdsPresetDrawer from "./AdsPresetDrawer.vue";
import { useAdsPresets } from "./useAdsPresets";

/**
 * Settings › Ads control's concept presets (E2; plan D-AD11). The same doors and the same rule as the brand kits
 * card: `session.admin` is what `requireAdminOnly("ads.brand-kit")` asks, and anyone else reads what is saved.
 */
const session = useSessionStore();
const presets = useAdsPresets();
const admin = computed(() => session.admin);
const live = computed(() => (presets.data.value ?? []).filter((p) => p.archived_at === null));

const drawerOpen = ref(false);
const editing = ref<AdPresetView | null>(null);
function open(preset: AdPresetView | null): void {
  editing.value = preset;
  drawerOpen.value = true;
}
</script>

<template>
  <BaseCard>
    <div class="flex items-start justify-between gap-4">
      <div>
        <h2 class="text-sm font-semibold text-ink">Presets</h2>
        <p class="text-sm text-ink-muted">The ad concepts the agent may use. It fills in their slots and changes nothing else.</p>
      </div>
      <BaseButton v-if="admin" data-test="new-preset" @click="open(null)">New preset</BaseButton>
    </div>
    <QueryState :loading="presets.isLoading.value" :error="presets.error.value" error-text="Could not load the presets." :retrying="presets.isFetching.value" @retry="presets.refetch()">
      <p v-if="live.length === 0" class="mt-4 text-sm text-ink-muted" data-test="no-presets">No preset yet, so no ad can be made.</p>
      <ul v-else class="mt-4 divide-y divide-edge">
        <li v-for="p in live" :key="p.id" class="flex items-center justify-between gap-4 py-3" data-test="preset-row">
          <div class="min-w-0">
            <p class="text-sm font-semibold text-ink">{{ p.key }}<template v-if="p.current"> · {{ p.current.body.name }}</template></p>
            <p v-if="p.current" class="text-xs text-ink-muted">
              {{ p.current.enabled ? "In use" : "Not in use" }} · version {{ p.current.version }} · saved {{ formatDateTime(p.current.saved_at) }} by {{ p.current.saved_by_name }}
            </p>
          </div>
          <BaseButton v-if="admin" data-test="edit-preset" @click="open(p)">Edit</BaseButton>
        </li>
      </ul>
    </QueryState>
    <AdsPresetDrawer :open="drawerOpen" :preset="editing" @close="drawerOpen = false" />
  </BaseCard>
</template>
