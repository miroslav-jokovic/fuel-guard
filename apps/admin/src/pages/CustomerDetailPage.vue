<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { MODULE_LABELS, type ModuleKey } from "@silvicom/shared";
import {
  AppButton,
  AppCallout,
  AppCard,
  AppInput,
  AppPageHeader,
  DataTable,
  FactList,
  QueryState,
  StatCard,
  type DataTableColumn,
} from "@silvicom/ui";
import AppShell from "@/layouts/AppShell.vue";
import OrgSwitchCard, { type OrgSwitch } from "@/components/OrgSwitchCard.vue";
import { useImpersonationStore } from "@/stores/impersonation";
import { useMeQuery, useOrgMembersQuery, useOrgQuery } from "@/lib/queries";
import { fmtDate } from "@/lib/format";

/**
 * One customer (US7, D-US11): the web app's record-page anatomy — `QueryState` around the record
 * (with its not-found state, D-US10), `StatCard` for the four figures, `FactList` for the facts, a
 * `DataTable` for the members — where it was hand-built tiles, a `<dl>`, an `AppTable`, and one
 * `error` ref that any refused change also wrote, blanking the page.
 *
 * The members are their own read with their own states: a customer whose member list fails to load
 * is still a customer whose switches work.
 */
const route = useRoute();
const router = useRouter();
const id = computed(() => String(route.params.id));

const org = useOrgQuery(id);
const members = useOrgMembersQuery(id);
const me = useMeQuery();

const canManage = computed(() => me.data.value?.role === "platform_owner" || me.data.value?.role === "platform_admin");
const canImpersonate = computed(() => me.data.value !== undefined && me.data.value.role !== "platform_readonly");

const integrations = computed<OrgSwitch[]>(() =>
  (org.data.value?.modules ?? []).map((m) => ({
    key: m.provider,
    label: m.provider.charAt(0).toUpperCase() + m.provider.slice(1),
    on: m.enabled,
    status: m.enabled ? "enabled" : "off",
  })),
);
const entitlements = computed<OrgSwitch[]>(() =>
  (org.data.value?.entitlements ?? []).map((e) => ({
    key: e.moduleKey,
    label: MODULE_LABELS[e.moduleKey as ModuleKey] ?? e.moduleKey,
    on: e.enabled,
    status: e.enabled ? "granted" : e.granted ? "revoked" : "not granted",
  })),
);

const facts = computed(() => {
  const o = org.data.value;
  if (!o) return [];
  return [
    { label: "Allowed domains", value: o.allowedDomains.length ? o.allowedDomains.join(", ") : "Any" },
    { label: "Created", value: fmtDate(o.createdAt) },
    { label: "Last activity", value: o.lastTxnAt ? fmtDate(o.lastTxnAt) : null },
  ];
});

const MEMBER_COLUMNS: DataTableColumn[] = [
  { key: "email", label: "Email", cellClass: "text-ink" },
  { key: "role", label: "Role", cellClass: "capitalize text-ink-secondary", width: "md" },
  { key: "createdAt", label: "Joined", cellClass: "text-ink-secondary", width: "md" },
];

// ── support access ─────────────────────────────────────────────────────────────────────────────
const imp = useImpersonationStore();
void imp.load().catch(() => {});
const activeGrant = computed(() => imp.activeForOrg(id.value));
const reason = ref("");
const starting = ref(false);
const startError = ref<string | null>(null);
async function startSession() {
  if (reason.value.trim().length < 3) {
    startError.value = "Enter a reason of at least 3 characters.";
    return;
  }
  startError.value = null;
  starting.value = true;
  try {
    await imp.start(id.value, reason.value.trim());
    await router.push({ name: "customer-view", params: { id: id.value } });
  } catch {
    startError.value = "Could not start the session.";
  } finally {
    starting.value = false;
  }
}
</script>

<template>
  <AppShell>
    <AppPageHeader :title="org.data.value?.name ?? 'Customer'" :description="org.data.value ? `Created ${fmtDate(org.data.value.createdAt)}` : undefined">
      <template #back>
        <AppButton size="sm" variant="ghost" :to="{ name: 'customers' }">← Customers</AppButton>
      </template>
    </AppPageHeader>

    <QueryState
      class="mt-5"
      :loading="org.isPending.value"
      :error="org.error.value"
      error-text="Could not load this customer."
      not-found-text="No customer has that id."
      loading-text="Loading the customer…"
      :retrying="org.isFetching.value"
      @retry="() => org.refetch()"
    >
      <template v-if="org.data.value">
        <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label="Members" :value="org.data.value.memberCount" />
          <StatCard label="Vehicles" :value="`${org.data.value.activeVehicleCount}/${org.data.value.vehicleCount}`" sub="active of all" />
          <StatCard label="Drivers" :value="org.data.value.driverCount" />
          <StatCard label="Open alerts" :value="org.data.value.openAnomalyCount" />
        </div>

        <AppCard class="mt-4">
          <h2 class="text-sm font-semibold text-ink-secondary">Settings</h2>
          <FactList class="mt-3" :facts="facts" :columns="3" />
        </AppCard>

        <OrgSwitchCard
          class="mt-4"
          :org-id="id"
          kind="modules"
          title="Integrations"
          description="Connected data providers. This is a kill switch: it never provisions credentials."
          :items="integrations"
          :can-manage="canManage"
          :verbs="['Enable', 'Disable']"
          :off-consequence="(label) => `${label} stops syncing for this customer until it is enabled again. Nothing already synced is removed.`"
          empty-text="No integrations connected."
        />

        <OrgSwitchCard
          class="mt-4"
          :org-id="id"
          kind="entitlements"
          title="Entitlements"
          description="Which Silvicom 360 products this customer has bought. Granting a module is what makes its screens exist for their organization. Every change is recorded in the platform log and the customer's audit trail."
          :items="entitlements"
          :can-manage="canManage"
          :verbs="['Grant', 'Revoke']"
          :off-consequence="(label) => `${label}'s screens disappear for everyone at this customer. Their data is kept, and granting it again brings the screens back.`"
          empty-text="No modules are offered yet."
        />

        <AppCard class="mt-4">
          <div class="flex items-center justify-between gap-3">
            <div>
              <h2 class="text-sm font-semibold text-ink-secondary">Idle engine checks</h2>
              <p class="mt-1 text-xs text-ink-muted">
                Whether the new idle measurement agrees with the trucks' own computers, and what their engines
                burn while parked. Opening it is recorded in the platform log.
              </p>
            </div>
            <AppButton size="sm" variant="soft" :to="{ name: 'customer-idle-engine', params: { id } }">Open</AppButton>
          </div>
        </AppCard>

        <AppCard padding="none" class="mt-4">
          <h2 class="px-5 pt-5 text-sm font-semibold text-ink-secondary">Members</h2>
          <DataTable
            class="mt-3"
            embedded
            :columns="MEMBER_COLUMNS"
            :rows="members.data.value ?? []"
            row-key="userId"
            :loading="members.isPending.value"
            :error="members.isError.value ? 'Could not load the members.' : null"
            :retrying="members.isFetching.value"
            empty-text="No members."
            @retry="() => members.refetch()"
          >
            <template #cell-email="{ value }">{{ value ?? "—" }}</template>
            <template #cell-role="{ value }">{{ String(value).replace("_", " ") }}</template>
            <template #cell-createdAt="{ value }">{{ fmtDate(value) }}</template>
          </DataTable>
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
              <AppCallout v-if="startError" tone="danger" class="mt-2" role="alert">{{ startError }}</AppCallout>
            </div>
            <AppButton type="submit" variant="primary" :disabled="starting">
              {{ starting ? "Starting…" : "Start read-only session" }}
            </AppButton>
          </form>
        </AppCard>
      </template>
    </QueryState>
  </AppShell>
</template>
