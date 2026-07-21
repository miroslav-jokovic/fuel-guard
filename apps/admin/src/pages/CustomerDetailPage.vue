<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRoute } from "vue-router";
import { AppCard, AppButton } from "@fuelguard/ui";
import AppShell from "@/layouts/AppShell.vue";
import { apiGet, type OrgDetail } from "@/lib/api";
import { fmtDate } from "@/lib/format";

const route = useRoute();
const org = ref<OrgDetail | null>(null);
const error = ref<string | null>(null);
const loading = ref(true);

onMounted(async () => {
  try {
    const { org: detail } = await apiGet<{ org: OrgDetail }>(`/admin/orgs/${route.params.id as string}`);
    org.value = detail;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Could not load this customer";
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <AppShell>
    <AppButton size="sm" variant="ghost" :to="{ name: 'customers' }">← Customers</AppButton>

    <div v-if="loading" class="mt-4 text-sm text-ink-muted">Loading…</div>
    <div v-else-if="error" class="mt-4 text-sm text-danger-600">{{ error }}</div>

    <template v-else-if="org">
      <h1 class="mt-2 text-xl font-semibold text-ink">{{ org.name }}</h1>
      <p class="mt-1 text-sm text-ink-muted">Created {{ fmtDate(org.createdAt) }}</p>

      <div class="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <AppCard>
          <div class="text-xs font-medium uppercase text-ink-muted">Members</div>
          <div class="mt-1 text-2xl font-semibold text-ink">{{ org.memberCount }}</div>
        </AppCard>
        <AppCard>
          <div class="text-xs font-medium uppercase text-ink-muted">Vehicles</div>
          <div class="mt-1 text-2xl font-semibold text-ink">{{ org.activeVehicleCount }}<span class="text-base text-ink-muted">/{{ org.vehicleCount }}</span></div>
        </AppCard>
        <AppCard>
          <div class="text-xs font-medium uppercase text-ink-muted">Drivers</div>
          <div class="mt-1 text-2xl font-semibold text-ink">{{ org.driverCount }}</div>
        </AppCard>
        <AppCard>
          <div class="text-xs font-medium uppercase text-ink-muted">Open alerts</div>
          <div class="mt-1 text-2xl font-semibold" :class="org.openAnomalyCount > 0 ? 'text-danger-600' : 'text-ink'">{{ org.openAnomalyCount }}</div>
        </AppCard>
      </div>

      <div class="mt-4 grid gap-4 sm:grid-cols-2">
        <AppCard>
          <h2 class="text-sm font-semibold text-ink-secondary">Settings</h2>
          <dl class="mt-3 space-y-2 text-sm">
            <div class="flex gap-2">
              <dt class="w-32 shrink-0 text-ink-muted">Allowed domains</dt>
              <dd class="text-ink">{{ org.allowedDomains.length ? org.allowedDomains.join(", ") : "— (any)" }}</dd>
            </div>
            <div class="flex gap-2">
              <dt class="w-32 shrink-0 text-ink-muted">Last activity</dt>
              <dd class="text-ink">{{ fmtDate(org.lastTxnAt) }}</dd>
            </div>
          </dl>
        </AppCard>
        <AppCard>
          <h2 class="text-sm font-semibold text-ink-secondary">Modules</h2>
          <ul class="mt-3 space-y-2 text-sm">
            <li v-for="m in org.modules" :key="m.provider" class="flex items-center justify-between">
              <span class="text-ink capitalize">{{ m.provider }}</span>
              <span :class="m.enabled ? 'text-success-700' : 'text-ink-muted'">{{ m.enabled ? "enabled" : "off" }}</span>
            </li>
            <li v-if="org.modules.length === 0" class="text-ink-muted">No optional modules connected.</li>
          </ul>
        </AppCard>
      </div>
    </template>
  </AppShell>
</template>
