<script setup lang="ts">
import { computed, ref } from "vue";
import type { QualCertSnapshot } from "@fuelguard/shared";
import { qualifyDriver } from "@fuelguard/shared";
import { useSessionStore } from "@/stores/session";
import { useDriversQuery } from "@/composables/useDrivers";
import { useAllDriverCertsQuery } from "@/composables/useCompliance";
import PageHeader from "@/components/ui/PageHeader.vue";
import BaseButton from "@/components/ui/BaseButton.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import StatusBadge from "@/components/StatusBadge.vue";
import SlideOver from "@/components/SlideOver.vue";
import KebabMenu from "@/components/KebabMenu.vue";
import CertManager from "@/features/hazmat/CertManager.vue";

/**
 * Compliance — the "who can haul hazmat" roster. Each driver's row shows whether they are
 * hazmat-qualified (computed with the SAME qualifyDriver gate the analysis uses) and what is
 * missing/expired; clicking a driver opens a drawer to manage their certifications. The carrier's
 * own records (PHMSA registration, insurance) live behind the header button. Populating these is
 * what turns a hazmat load from "needs review" into a clear.
 */
const session = useSessionStore();
const { data: drivers, isLoading, isError, error, refetch, isFetching } = useDriversQuery();
const { data: driverCerts } = useAllDriverCertsQuery();

const today = new Date().toISOString().slice(0, 10);

const certsByDriver = computed(() => {
  const m = new Map<string, QualCertSnapshot[]>();
  for (const c of driverCerts.value ?? []) {
    const arr = m.get(c.subject_id) ?? [];
    arr.push({ kind: c.kind, qualifier: c.qualifier, trainingType: c.training_type, issuedAt: c.issued_at, expiresAt: c.expires_at });
    m.set(c.subject_id, arr);
  }
  return m;
});

function labelForCode(code: string): string {
  const c = code.replace(/^driver_unqualified:/, "").replace(/^training_/, "training: ").replace(/_/g, " ");
  return c.charAt(0).toUpperCase() + c.slice(1);
}

interface Row { id: string; full_name: string; status: string; ready: boolean; issues: string[] }
const rows = computed<Row[]>(() =>
  (drivers.value ?? []).map((d) => {
    const certs = certsByDriver.value.get(d.id) ?? [];
    const res = qualifyDriver({ evalDate: today, driverStatus: d.status, certs, vehicleKind: "cargo_tank", orgHasSecurityPlan: false });
    return { id: d.id, full_name: d.full_name, status: d.status, ready: res.qualified, issues: res.findings.map((f) => labelForCode(f.code)) };
  }),
);

const search = ref("");
const readyFilter = ref<string>("");
const readyOptions = [
  { value: "", label: "All drivers" },
  { value: "ready", label: "Hazmat ready" },
  { value: "not_ready", label: "Not ready" },
];
const filtered = computed(() =>
  rows.value.filter((r) => {
    if (readyFilter.value === "ready" && !r.ready) return false;
    if (readyFilter.value === "not_ready" && r.ready) return false;
    if (search.value && !r.full_name.toLowerCase().includes(search.value.toLowerCase())) return false;
    return true;
  }),
);

const columns: DataTableColumn[] = [
  { key: "full_name", label: "Driver", headerClass: "min-w-[12rem]", cellClass: "font-medium text-ink" },
  { key: "status", label: "Employment", headerClass: "min-w-[7rem]" },
  { key: "ready", label: "Hazmat qualification", headerClass: "min-w-[9rem]" },
  { key: "issues", label: "Missing / expired", headerClass: "min-w-[16rem]", cellClass: "text-ink-secondary" },
];

const driverOpen = ref(false);
const activeDriver = ref<Row | null>(null);
function manage(r: Row) { activeDriver.value = r; driverOpen.value = true; }
const carrierOpen = ref(false);
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Who can haul hazmat. Each driver's hazmat qualification is checked with the same rules the analysis gate uses — CDL, medical card, H/X endorsement and the §172.704 training types; the carrier needs current PHMSA registration and insurance. Missing or expired records keep a load in review.">
      <template #actions>
        <BaseButton v-if="session.canManage" @click="carrierOpen = true">Carrier records</BaseButton>
      </template>
    </PageHeader>

    <FilterBar v-model:search="search" search-placeholder="Search drivers…" :count="filtered.length" count-label="drivers">
      <template #filters>
        <FilterSelect v-model="readyFilter" label="Hazmat" :options="readyOptions" />
      </template>
    </FilterBar>

    <DataTable
      :columns="columns"
      :rows="filtered"
      row-key="id"
      :loading="isLoading"
      :error="isError ? (error instanceof Error ? error.message : 'Failed to load drivers') : null"
      :retrying="isFetching"
      empty-text="No drivers match these filters."
      @retry="refetch"
    >
      <template #cell-full_name="{ row }">
        <button class="font-medium text-brand-600 hover:text-brand-500" @click="manage(row)">{{ row.full_name }}</button>
      </template>
      <template #cell-status="{ row }"><StatusBadge :status="row.status" /></template>
      <template #cell-ready="{ row }">
        <span
          class="inline-flex rounded px-1.5 py-0.5 text-xs font-semibold"
          :class="row.ready ? 'bg-success-100 text-success-700' : 'bg-danger-100 text-danger-700'"
        >{{ row.ready ? "Ready" : "Not ready" }}</span>
      </template>
      <template #cell-issues="{ row }">
        <span v-if="row.ready" class="text-ink-subtle">—</span>
        <span v-else class="text-xs text-ink-secondary">{{ row.issues.join(", ") }}</span>
      </template>
      <template #actions="{ row }">
        <KebabMenu v-if="session.canManage">
          <button class="kebab-item" @click="manage(row)">Manage certifications…</button>
        </KebabMenu>
      </template>
    </DataTable>

    <SlideOver :open="driverOpen" :title="activeDriver ? `Certifications — ${activeDriver.full_name}` : 'Certifications'" @close="driverOpen = false">
      <CertManager v-if="activeDriver" :key="activeDriver.id" subject-type="driver" :subject-id="activeDriver.id" />
    </SlideOver>

    <SlideOver :open="carrierOpen" title="Carrier records (PHMSA registration, insurance)" @close="carrierOpen = false">
      <CertManager v-if="session.orgId" subject-type="organization" :subject-id="session.orgId || ''" />
    </SlideOver>
  </div>
</template>
