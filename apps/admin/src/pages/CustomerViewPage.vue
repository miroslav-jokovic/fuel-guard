<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { AppCard, AppButton } from "@fuelguard/ui";
import AppShell from "@/layouts/AppShell.vue";
import { apiGet, type ViewAnomaly } from "@/lib/api";
import { useImpersonationStore } from "@/stores/impersonation";
import { fmtDateTime } from "@/lib/format";

const route = useRoute();
const router = useRouter();
const id = route.params.id as string;
const imp = useImpersonationStore();

const anomalies = ref<ViewAnomaly[]>([]);
const error = ref<string | null>(null);
const loading = ref(true);
const grant = computed(() => imp.activeForOrg(id));

onMounted(async () => {
  try {
    if (!imp.loaded) await imp.load();
    if (!imp.activeForOrg(id)) return; // no active session → template shows the notice
    const { anomalies: a } = await apiGet<{ anomalies: ViewAnomaly[] }>(`/admin/orgs/${id}/view/anomalies`);
    anomalies.value = a;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Could not load the customer view";
  } finally {
    loading.value = false;
  }
});

async function endSession() {
  const g = imp.activeForOrg(id);
  if (g) await imp.revoke(g.id);
  await router.push({ name: "customer", params: { id } });
}

const SEV: Record<string, string> = {
  critical: "text-danger-700",
  high: "text-danger-600",
  medium: "text-warning-700",
  low: "text-ink-muted",
};
</script>

<template>
  <AppShell>
    <div v-if="loading" class="text-sm text-ink-muted">Loading…</div>

    <AppCard v-else-if="!grant">
      <p class="text-sm text-ink">No active read-only session for this customer.</p>
      <AppButton class="mt-3" size="sm" :to="{ name: 'customer', params: { id } }">Back to customer</AppButton>
    </AppCard>

    <template v-else>
      <div class="flex items-start justify-between gap-4 rounded-lg bg-warning-100 p-4 text-warning-800">
        <div>
          <h1 class="text-lg font-semibold">Read-only customer view</h1>
          <p class="mt-0.5 text-sm">
            Session reason: “{{ grant.reason }}” · expires {{ fmtDateTime(grant.expiresAt) }}. Everything you
            do here is logged in this customer's own audit trail.
          </p>
        </div>
        <AppButton variant="danger" size="sm" @click="endSession">End session</AppButton>
      </div>

      <p v-if="error" class="mt-4 text-sm text-danger-600">{{ error }}</p>

      <AppCard padding="none" class="mt-4">
        <h2 class="px-5 pt-5 text-sm font-semibold text-ink-secondary">Recent alerts</h2>
        <table class="mt-3 w-full text-sm">
          <thead class="bg-surface-subtle text-left text-xs font-semibold uppercase tracking-wide text-ink-muted">
            <tr>
              <th class="px-5 py-2">Severity</th>
              <th class="px-5 py-2">Status</th>
              <th class="px-5 py-2">Alert</th>
              <th class="px-5 py-2">Raised</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="a in anomalies" :key="a.id" class="border-t border-edge-subtle">
              <td class="px-5 py-2 font-medium capitalize" :class="SEV[a.severity] ?? 'text-ink'">{{ a.severity }}</td>
              <td class="px-5 py-2 capitalize text-ink-secondary">{{ a.status }}</td>
              <td class="px-5 py-2 text-ink">{{ a.message }}</td>
              <td class="px-5 py-2 text-ink-secondary">{{ fmtDateTime(a.createdAt) }}</td>
            </tr>
            <tr v-if="anomalies.length === 0">
              <td colspan="4" class="px-5 py-6 text-center text-ink-muted">No alerts.</td>
            </tr>
          </tbody>
        </table>
      </AppCard>
    </template>
  </AppShell>
</template>
