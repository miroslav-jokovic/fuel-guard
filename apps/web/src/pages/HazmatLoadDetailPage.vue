<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute } from "vue-router";
import type { HazmatRunRow } from "@fuelguard/shared";
import PageHeader from "@/components/ui/PageHeader.vue";
import BaseCard from "@/components/ui/BaseCard.vue";
import BaseButton from "@/components/ui/BaseButton.vue";
import BaseInput from "@/components/ui/BaseInput.vue";
import { useVehiclesQuery } from "@/composables/useVehicles";
import { useDriversQuery } from "@/composables/useDrivers";
import LoadStatusBadge from "@/features/hazmat/LoadStatusBadge.vue";
import VerdictPanel from "@/features/hazmat/VerdictPanel.vue";
import type { CalcResult } from "@/features/hazmat/calcModel";
import {
  isAnalyzing,
  useHazmatLoadQuery,
  useHazmatRunsQuery,
  useSubmitLoad,
  useAnalyzeLoad,
  useCancelLoad,
} from "@/features/hazmat/useHazmatLoads";

/**
 * Hazmat load detail (plan H5). Shows the declared load, drives it through submit → analyze, and renders
 * the resulting engine verdict (reusing VerdictPanel) with its findings and flags. Analysis runs in-process
 * server-side; this view polls while the load is mid-analysis and stops the moment it settles. Clearing /
 * review is the H7 review queue — flagged loads are view-only here (nothing can be cleared from this page).
 */
const route = useRoute();
const id = computed(() => (Array.isArray(route.params.id) ? route.params.id[0] : route.params.id) as string | undefined);

const { data: load, isLoading, isError, error } = useHazmatLoadQuery(id);
const analyzing = computed(() => isAnalyzing(load.value?.status));
const { data: runs } = useHazmatRunsQuery(id, analyzing);

const { data: vehicles } = useVehiclesQuery();
const { data: drivers } = useDriversQuery();
const vehicleLabel = computed(() => {
  const v = (vehicles.value ?? []).find((x) => x.id === load.value?.vehicle_id);
  return v ? `Unit ${v.unit_number}` : "—";
});
const driverLabel = computed(() => {
  const d = (drivers.value ?? []).find((x) => x.id === load.value?.driver_id);
  return d ? d.full_name : "—";
});

const submit = useSubmitLoad();
const analyze = useAnalyzeLoad();
const cancel = useCancelLoad();
const actionError = ref<string | null>(null);
const showCancel = ref(false);
const cancelReason = ref("");

const busy = computed(() => submit.isPending.value || analyze.isPending.value || cancel.isPending.value || analyzing.value);

async function submitAndAnalyze() {
  actionError.value = null;
  try {
    if (load.value?.status === "draft") await submit.mutateAsync(id.value!);
    await analyze.mutateAsync(id.value!);
  } catch (e) {
    actionError.value = e instanceof Error ? e.message : "Action failed.";
  }
}
async function doCancel() {
  actionError.value = null;
  try {
    await cancel.mutateAsync({ id: id.value!, reason: cancelReason.value.trim() || "cancelled by user" });
    showCancel.value = false;
    cancelReason.value = "";
  } catch (e) {
    actionError.value = e instanceof Error ? e.message : "Cancel failed.";
  }
}

// ── verdict view ────────────────────────────────────────────────────────────────
const latestRun = computed<HazmatRunRow | undefined>(() => runs.value?.[0]);
function isVerdict(v: unknown): boolean {
  return typeof v === "object" && v !== null && "placards" in (v as Record<string, unknown>);
}
const verdictResult = computed<CalcResult | null>(() => {
  const run = latestRun.value;
  if (!run || !isVerdict(run.verdict)) return null;
  return {
    engineVersion: run.engine_version,
    datasetVersion: run.dataset_version,
    datasetProvisional: run.flags.includes("provisional_dataset"),
    verdict: run.verdict as CalcResult["verdict"],
  };
});
const runError = computed<string | null>(() => {
  const v = latestRun.value?.verdict as { error?: string } | undefined;
  return v && typeof v === "object" && "error" in v ? (v.error ?? "Analysis failed.") : null;
});

const canCancel = computed(() => ["draft", "submitted", "needs_review"].includes(load.value?.status ?? ""));
const primaryLabel = computed(() =>
  load.value?.status === "draft" ? "Submit & analyze" : load.value?.status === "submitted" ? "Analyze" : "Re-analyze",
);
const canPrimary = computed(() => ["draft", "submitted"].includes(load.value?.status ?? ""));

function declaredLine(l: unknown): { hmtRef: string; qty: string } {
  const o = (l ?? {}) as { hmtRef?: string; quantity?: { value?: number; unit?: string } };
  return {
    hmtRef: o.hmtRef ?? "—",
    qty: o.quantity ? `${o.quantity.value ?? "?"} ${o.quantity.unit ?? ""}`.trim() : "—",
  };
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Hazmat load — analysis, placards and findings.">
      <template #actions>
        <BaseButton variant="ghost" size="sm" to="/hazmat/loads">← Loads</BaseButton>
      </template>
    </PageHeader>

    <p v-if="isLoading" class="text-sm text-ink-muted">Loading…</p>
    <p v-else-if="isError" class="text-sm text-danger-600">{{ error instanceof Error ? error.message : "Not found." }}</p>

    <template v-else-if="load">
      <BaseCard>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-center gap-3">
            <LoadStatusBadge :status="load.status" />
            <span v-if="analyzing" class="text-xs text-ink-muted">Analyzing…</span>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <BaseButton v-if="canPrimary" variant="primary" size="sm" :disabled="busy" @click="submitAndAnalyze">
              {{ busy && !showCancel ? "Working…" : primaryLabel }}
            </BaseButton>
            <BaseButton v-if="canCancel" variant="soft" size="sm" :disabled="busy" @click="showCancel = !showCancel">Cancel load</BaseButton>
          </div>
        </div>

        <div v-if="showCancel" class="mt-3 flex flex-wrap items-end gap-2">
          <div class="grow">
            <label class="block text-sm font-medium text-ink-secondary">Reason</label>
            <BaseInput v-model="cancelReason" class="mt-1" placeholder="Why is this load being cancelled?" />
          </div>
          <BaseButton variant="danger" size="sm" :disabled="cancel.isPending.value" @click="doCancel">Confirm cancel</BaseButton>
        </div>
        <p v-if="actionError" class="mt-2 text-sm text-danger-600">{{ actionError }}</p>

        <dl class="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
          <div><dt class="text-ink-subtle">Vehicle</dt><dd class="text-ink">{{ vehicleLabel }}</dd></div>
          <div><dt class="text-ink-subtle">Driver</dt><dd class="text-ink">{{ driverLabel }}</dd></div>
          <div><dt class="text-ink-subtle">Tank state</dt><dd class="capitalize text-ink">{{ load.tank_state.replace(/_/g, " ") }}</dd></div>
          <div><dt class="text-ink-subtle">Carrier</dt><dd class="capitalize text-ink">{{ load.carrier_relationship.replace(/_/g, " ") }}</dd></div>
        </dl>
      </BaseCard>

      <BaseCard>
        <h2 class="text-sm font-semibold text-ink">Declared products</h2>
        <ul class="mt-2 divide-y divide-edge text-sm">
          <li v-for="(l, i) in load.declared_lines" :key="i" class="flex items-center justify-between py-2">
            <span class="font-mono text-ink-secondary">{{ declaredLine(l).hmtRef }}</span>
            <span class="text-ink">{{ declaredLine(l).qty }}</span>
          </li>
          <li v-if="load.declared_lines.length === 0" class="py-2 text-ink-muted">No products declared.</li>
        </ul>
      </BaseCard>

      <!-- review-queue note -->
      <BaseCard v-if="load.status === 'needs_review'">
        <p class="text-sm text-ink-secondary">
          This load is flagged and needs review. The field-by-field review + attestation queue arrives with
          H7 — for now the findings below are the decision support; nothing can be cleared from this page.
        </p>
      </BaseCard>

      <!-- verdict -->
      <div v-if="latestRun">
        <div v-if="runError" class="rounded-lg bg-danger-50 px-4 py-3 text-sm text-danger-700 ring-1 ring-inset ring-danger-200">
          Analysis failed: {{ runError }}
        </div>
        <VerdictPanel v-else-if="verdictResult" :result="verdictResult" />
      </div>
      <BaseCard v-else-if="!analyzing" class="text-center">
        <p class="py-8 text-sm text-ink-muted">No analysis yet. Press <span class="font-medium text-ink">{{ primaryLabel }}</span> to run the engine.</p>
      </BaseCard>
    </template>
  </div>
</template>
