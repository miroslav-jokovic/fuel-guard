<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { AppCard, AppButton, AppInput } from "@fuelguard/ui";
import AppShell from "@/layouts/AppShell.vue";
import { apiGet, apiPost, type OrgDetail, type OrgMember, type Me } from "@/lib/api";
import { useImpersonationStore } from "@/stores/impersonation";
import { fmtDate } from "@/lib/format";

const route = useRoute();
const router = useRouter();
const id = route.params.id as string;

const org = ref<OrgDetail | null>(null);
const members = ref<OrgMember[]>([]);
const me = ref<Me | null>(null);
const error = ref<string | null>(null);
const loading = ref(true);
const toggling = ref<string | null>(null);

const canManageModules = computed(() => me.value?.role === "platform_owner" || me.value?.role === "platform_admin");
const canImpersonate = computed(() => me.value?.role !== undefined && me.value.role !== "platform_readonly");

const imp = useImpersonationStore();
const reason = ref("");
const starting = ref(false);
const startError = ref<string | null>(null);
const activeGrant = computed(() => imp.activeForOrg(id));

async function startSession() {
  if (reason.value.trim().length < 3) {
    startError.value = "Please enter a reason (at least 3 characters).";
    return;
  }
  startError.value = null;
  starting.value = true;
  try {
    await imp.start(id, reason.value.trim());
    await router.push({ name: "customer-view", params: { id } });
  } catch (e) {
    startError.value = e instanceof Error ? e.message : "Could not start the session";
  } finally {
    starting.value = false;
  }
}

onMounted(async () => {
  try {
    const [{ org: detail }, { members: mem }, whoami] = await Promise.all([
      apiGet<{ org: OrgDetail }>(`/admin/orgs/${id}`),
      apiGet<{ members: OrgMember[] }>(`/admin/orgs/${id}/members`),
      apiGet<Me>("/admin/me"),
    ]);
    org.value = detail;
    members.value = mem;
    me.value = whoami;
    await imp.load().catch(() => {});
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Could not load this customer";
  } finally {
    loading.value = false;
  }
});

async function toggleModule(provider: string, enabled: boolean) {
  if (!org.value) return;
  toggling.value = provider;
  try {
    await apiPost(`/admin/orgs/${id}/modules/${provider}`, { enabled });
    const m = org.value.modules.find((x) => x.provider === provider);
    if (m) m.enabled = enabled;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Could not update the module";
  } finally {
    toggling.value = null;
  }
}
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
            <li v-for="m in org.modules" :key="m.provider" class="flex items-center justify-between gap-2">
              <span class="capitalize text-ink">{{ m.provider }}</span>
              <div class="flex items-center gap-2">
                <span :class="m.enabled ? 'text-success-700' : 'text-ink-muted'">{{ m.enabled ? "enabled" : "off" }}</span>
                <AppButton
                  v-if="canManageModules"
                  size="sm"
                  :variant="m.enabled ? 'soft' : 'primary'"
                  :disabled="toggling === m.provider"
                  @click="toggleModule(m.provider, !m.enabled)"
                >
                  {{ m.enabled ? "Disable" : "Enable" }}
                </AppButton>
              </div>
            </li>
            <li v-if="org.modules.length === 0" class="text-ink-muted">No optional modules connected.</li>
          </ul>
        </AppCard>
      </div>

      <AppCard padding="none" class="mt-4">
        <h2 class="px-5 pt-5 text-sm font-semibold text-ink-secondary">Members</h2>
        <table class="mt-3 w-full text-sm">
          <thead class="bg-surface-subtle text-left text-xs font-semibold uppercase tracking-wide text-ink-muted">
            <tr>
              <th class="px-5 py-2">Email</th>
              <th class="px-5 py-2">Role</th>
              <th class="px-5 py-2">Joined</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="mem in members" :key="mem.userId" class="border-t border-edge-subtle">
              <td class="px-5 py-2 text-ink">{{ mem.email ?? "—" }}</td>
              <td class="px-5 py-2 capitalize text-ink-secondary">{{ mem.role.replace("_", " ") }}</td>
              <td class="px-5 py-2 text-ink-secondary">{{ fmtDate(mem.createdAt) }}</td>
            </tr>
            <tr v-if="members.length === 0">
              <td colspan="3" class="px-5 py-6 text-center text-ink-muted">No members.</td>
            </tr>
          </tbody>
        </table>
      </AppCard>

      <AppCard v-if="canImpersonate" class="mt-4">
        <h2 class="text-sm font-semibold text-ink-secondary">Support access</h2>
        <p class="mt-1 text-sm text-ink-muted">
          Open a time-boxed, read-only view of this customer's data. The reason is required and recorded in
          both our platform log and the customer's own audit trail.
        </p>
        <div v-if="activeGrant" class="mt-3 flex items-center gap-3">
          <span class="text-sm text-success-700">A read-only session is active.</span>
          <AppButton size="sm" variant="primary" :to="{ name: 'customer-view', params: { id } }">Open view</AppButton>
        </div>
        <form v-else class="mt-3 flex items-start gap-2" @submit.prevent="startSession">
          <div class="flex-1">
            <AppInput v-model="reason" placeholder="Reason (e.g. investigating a reefer alert)" />
            <p v-if="startError" class="mt-1 text-sm text-danger-600">{{ startError }}</p>
          </div>
          <AppButton type="submit" variant="primary" :disabled="starting">
            {{ starting ? "Starting…" : "Start read-only session" }}
          </AppButton>
        </form>
      </AppCard>
    </template>
  </AppShell>
</template>
