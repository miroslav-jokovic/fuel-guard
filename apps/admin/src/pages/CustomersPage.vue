<script setup lang="ts">
import { ref, onMounted } from "vue";
import { AppCard } from "@fuelguard/ui";
import AppShell from "@/layouts/AppShell.vue";
import { apiGet, type OrgOverview } from "@/lib/api";
import { fmtDate } from "@/lib/format";

const orgs = ref<OrgOverview[]>([]);
const error = ref<string | null>(null);
const loading = ref(true);

onMounted(async () => {
  try {
    const { orgs: list } = await apiGet<{ orgs: OrgOverview[] }>("/admin/orgs");
    orgs.value = list;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Could not load customers";
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <AppShell>
    <h1 class="text-xl font-semibold text-ink">Customers</h1>
    <p class="mt-1 text-sm text-ink-muted">Every organization on the platform.</p>

    <AppCard padding="none" class="mt-5">
      <div v-if="loading" class="p-6 text-sm text-ink-muted">Loading…</div>
      <div v-else-if="error" class="p-6 text-sm text-danger-600">{{ error }}</div>
      <table v-else class="w-full text-sm">
        <thead class="bg-surface-subtle text-left text-xs font-semibold uppercase tracking-wide text-ink-muted">
          <tr>
            <th class="px-4 py-2.5">Organization</th>
            <th class="px-4 py-2.5 text-right">Members</th>
            <th class="px-4 py-2.5 text-right">Vehicles</th>
            <th class="px-4 py-2.5 text-right">Drivers</th>
            <th class="px-4 py-2.5 text-right">Open alerts</th>
            <th class="px-4 py-2.5">Last activity</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="o in orgs"
            :key="o.orgId"
            class="cursor-pointer border-t border-edge-subtle hover:bg-surface-subtle"
            @click="$router.push({ name: 'customer', params: { id: o.orgId } })"
          >
            <td class="px-4 py-2.5 font-medium text-ink">{{ o.name }}</td>
            <td class="px-4 py-2.5 text-right text-ink-secondary">{{ o.memberCount }}</td>
            <td class="px-4 py-2.5 text-right text-ink-secondary">{{ o.activeVehicleCount }}/{{ o.vehicleCount }}</td>
            <td class="px-4 py-2.5 text-right text-ink-secondary">{{ o.driverCount }}</td>
            <td class="px-4 py-2.5 text-right">
              <span :class="o.openAnomalyCount > 0 ? 'font-semibold text-danger-600' : 'text-ink-muted'">
                {{ o.openAnomalyCount }}
              </span>
            </td>
            <td class="px-4 py-2.5 text-ink-secondary">{{ fmtDate(o.lastTxnAt) }}</td>
          </tr>
          <tr v-if="orgs.length === 0">
            <td colspan="6" class="px-4 py-6 text-center text-ink-muted">No organizations yet.</td>
          </tr>
        </tbody>
      </table>
    </AppCard>
  </AppShell>
</template>
