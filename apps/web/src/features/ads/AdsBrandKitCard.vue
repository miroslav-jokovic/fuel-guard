<script setup lang="ts">
import { computed, ref } from "vue";
import type { AdBrandKitView } from "@silvicom/shared";
import { AppButton as BaseButton, AppCard as BaseCard, QueryState } from "@silvicom/ui";
import { formatDateTime } from "@/lib/format";
import { useSessionStore } from "@/stores/session";
import AdsBrandKitDrawer from "./AdsBrandKitDrawer.vue";
import { useAdsBrandKits } from "./useAdsBrandKits";

/**
 * Settings › Ads control's brand kits (E2; plan D-AD10). On this page and not its own because the plan puts the
 * kit in Settings and everything a kit needs from a person fits one drawer. `session.admin` is the `isAdmin`
 * that `requireAdminOnly("ads.brand-kit")` asks, as on the settings form, so nobody is offered a save the API
 * refuses; anyone else who can view recruiting reads what is saved.
 */
const session = useSessionStore();
const kits = useAdsBrandKits();
const admin = computed(() => session.admin);
const live = computed(() => (kits.data.value ?? []).filter((k) => k.archived_at === null));

const photoCount = (kit: AdBrandKitView): string => {
  const n = kit.current?.body.equipment_photos.length ?? 0;
  return n === 1 ? "1 photo" : `${n} photos`;
};

const drawerOpen = ref(false);
const editing = ref<AdBrandKitView | null>(null);
function open(kit: AdBrandKitView | null): void {
  editing.value = kit;
  drawerOpen.value = true;
}
</script>

<template>
  <BaseCard>
    <div class="flex items-start justify-between gap-4">
      <div>
        <h2 class="text-sm font-semibold text-ink">Brand kits</h2>
        <p class="text-sm text-ink-muted">The company name, colours, logo and equipment photos every ad is made from.</p>
      </div>
      <BaseButton v-if="admin" data-test="new-kit" @click="open(null)">New brand kit</BaseButton>
    </div>
    <QueryState :loading="kits.isLoading.value" :error="kits.error.value" error-text="Could not load the brand kits." :retrying="kits.isFetching.value" @retry="kits.refetch()">
      <p v-if="live.length === 0" class="mt-4 text-sm text-ink-muted" data-test="no-kits">No brand kit yet, so no ad can be made.</p>
      <ul v-else class="mt-4 divide-y divide-edge">
        <li v-for="kit in live" :key="kit.id" class="flex items-center justify-between gap-4 py-3" data-test="kit-row">
          <div class="min-w-0">
            <p class="text-sm font-semibold text-ink">{{ kit.name }}</p>
            <p v-if="kit.current" class="text-xs text-ink-muted">
              Version {{ kit.current.version }} · {{ photoCount(kit) }} · saved {{ formatDateTime(kit.current.saved_at) }} by {{ kit.current.saved_by_name }}
            </p>
          </div>
          <BaseButton v-if="admin" data-test="edit-kit" @click="open(kit)">Edit</BaseButton>
        </li>
      </ul>
    </QueryState>
    <AdsBrandKitDrawer :open="drawerOpen" :kit="editing" @close="drawerOpen = false" />
  </BaseCard>
</template>
