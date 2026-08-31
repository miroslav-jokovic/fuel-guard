<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute } from "vue-router";
import { HAZMAT_REVIEW_ROLES, type HazmatRunRow } from "@silvicom/shared";
import { useSessionStore } from "@/stores/session";
import ReviewPanel from "@/features/hazmat/ReviewPanel.vue";
import DeclaredProductsCard from "@/features/hazmat/DeclaredProductsCard.vue";
import { useDefensePacket } from "@/features/hazmat/useDefensePacket";
import LoadDeclarationCard from "@/features/hazmat/LoadDeclarationCard.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import { AppCard as BaseCard } from "@silvicom/ui";
import { AppButton as BaseButton } from "@silvicom/ui";
import { apiFetch } from "@/lib/api";
import { useToastStore } from "@/stores/toast";
import { AppInput as BaseInput } from "@silvicom/ui";
import { AppFormField as FormField } from "@silvicom/ui";
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

const packet = useDefensePacket();
const toast = useToastStore();

// M12.2 — verify the recorded verdict reproduces under its dataset, and diff vs the current one.
interface ReproduceDiff { placardsAdded: string[]; placardsRemoved: string[]; eligibilityBefore: string; eligibilityAfter: string; findingsAdded: string[]; findingsRemoved: string[] }
interface ReproduceResult {
  identical: boolean; identicalModuloVersions: boolean; decisionIdentical: boolean; reason: string | null;
  recordedDatasetVersion: string; source: string;
  currentDataset: { version: string; diff: ReproduceDiff } | null;
}
const reproduceResult = ref<ReproduceResult | null>(null);
const reproduceLoading = ref(false);
async function verifyReproducibility() {
  const loadId = id.value; const runId = latestRun.value?.id;
  if (!loadId || !runId) return;
  reproduceLoading.value = true; reproduceResult.value = null;
  const res = await apiFetch<ReproduceResult>(`/api/hazmat/loads/${loadId}/runs/${runId}/reproduce`);
  reproduceLoading.value = false;
  if (!res.ok) { toast.error("Could not verify reproducibility", res.error?.message); return; }
  reproduceResult.value = res.data ?? null;
}

const { data: load, isLoading, isError, error } = useHazmatLoadQuery(id);
const analyzing = computed(() => isAnalyzing(load.value?.status));
const { data: runs } = useHazmatRunsQuery(id, analyzing);

const submit = useSubmitLoad();
const analyze = useAnalyzeLoad();
const cancel = useCancelLoad();
const showCancel = ref(false);
const cancelReason = ref("");

const busy = computed(() => submit.isPending.value || analyze.isPending.value || cancel.isPending.value || analyzing.value);

async function submitAndAnalyze() {
  try {
    if (load.value?.status === "draft") await submit.mutateAsync(id.value!);
    await analyze.mutateAsync(id.value!);
    toast.success("Analysis started", "The verdict lands here in a moment.");
  } catch (e) {
    toast.error("Could not analyze this load", e instanceof Error ? e.message : undefined);
  }
}
async function doCancel() {
  try {
    await cancel.mutateAsync({ id: id.value!, reason: cancelReason.value.trim() || "cancelled by user" });
    showCancel.value = false;
    cancelReason.value = "";
    toast.success("Load cancelled");
  } catch (e) {
    toast.error("Could not cancel this load", e instanceof Error ? e.message : undefined);
  }
}

// ── verdict view ────────────────────────────────────────────────────────────────
const latestRun = computed<HazmatRunRow | undefined>(() => runs.value?.[0]);

// §5 qualification findings (M3) — a legal disqualification (§391 / §172.704) that can never be
// override-cleared. Flattened across driver + carrier, each with its CFR citation.
const qualFindings = computed(() => {
  const q = latestRun.value?.qualification;
  if (!q) return [] as Array<{ subject: string; message: string; citation: string }>;
  return [
    ...q.driver.map((f) => ({ subject: "Driver", message: f.message, citation: f.citation })),
    ...q.org.map((f) => ({ subject: "Carrier", message: f.message, citation: f.citation })),
  ];
});
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

const session = useSessionStore();
const canReview = computed(() => session.role != null && HAZMAT_REVIEW_ROLES.includes(session.role));
const canCancel = computed(() => ["draft", "submitted", "needs_review"].includes(load.value?.status ?? ""));
const primaryLabel = computed(() =>
  load.value?.status === "draft" ? "Submit & analyze" : load.value?.status === "submitted" ? "Analyze" : "Re-analyze",
);
const canPrimary = computed(() => ["draft", "submitted"].includes(load.value?.status ?? ""));
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Hazmat load — analysis, placards and findings.">
      <template #actions>
        <BaseButton v-if="latestRun" variant="ghost" size="sm" :disabled="packet.loading.value" @click="packet.download(id!)">{{ packet.loading.value ? "Preparing…" : "Defense packet" }}</BaseButton>
        <BaseButton variant="ghost" size="sm" to="/loads">← Loads</BaseButton>
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
          <FormField v-slot="{ id: reasonId }" label="Reason" class="grow">
            <BaseInput :id="reasonId" v-model="cancelReason" placeholder="Why is this load being cancelled?" />
          </FormField>
          <BaseButton variant="danger" size="sm" :disabled="cancel.isPending.value" @click="doCancel">Confirm cancel</BaseButton>
        </div>
      </BaseCard>

      <LoadDeclarationCard :load="load" :can-manage="session.can('hazmat')" />

      <DeclaredProductsCard :load="load" :can-manage="session.can('hazmat')" />

      <!-- review + attestation (H7) — review-role users only; RLS is the real gate -->
      <ReviewPanel v-if="load.status === 'needs_review' && canReview && latestRun" :load="load" :run="latestRun" />
      <BaseCard v-else-if="load.status === 'needs_review'">
        <p class="text-sm text-ink-secondary">
          This load is flagged and needs review by a trained reviewer (49 CFR 172 Subpart H). The findings
          below are the decision support.
        </p>
      </BaseCard>

      <!-- qualification (§5 gate) -->
      <BaseCard v-if="qualFindings.length" class="border-l-4 border-danger-400">
        <h2 class="text-sm font-semibold text-ink">Qualification — cannot clear</h2>
        <p class="mt-1 text-xs text-ink-muted">
          A legal disqualification (49 CFR §391 / §172.704). Fix the record in Compliance and re-run — this can never be override-cleared.
        </p>
        <ul class="mt-3 space-y-2">
          <li v-for="(f, i) in qualFindings" :key="i" class="text-sm">
            <span class="inline-block rounded-control bg-danger-50 px-1.5 py-0.5 text-xs font-medium text-danger-700 ring-1 ring-inset ring-danger-200">{{ f.subject }}</span>
            <span class="ml-2 text-ink">{{ f.message }}</span>
            <span class="ml-1 text-ink-muted">({{ f.citation }})</span>
          </li>
        </ul>
      </BaseCard>

      <!-- verdict -->
      <div v-if="latestRun">
        <div v-if="runError" class="rounded-surface bg-danger-50 px-4 py-3 text-sm text-danger-700 ring-1 ring-inset ring-danger-200">
          Analysis failed: {{ runError }}
        </div>
        <VerdictPanel v-else-if="verdictResult" :result="verdictResult" />
      </div>
      <BaseCard v-else-if="!analyzing" class="text-center">
        <p class="py-8 text-sm text-ink-muted">No analysis yet. Press <span class="font-medium text-ink">{{ primaryLabel }}</span> to run the engine.</p>
      </BaseCard>

      <!-- reproducibility (M12.2) -->
      <BaseCard v-if="latestRun && verdictResult">
        <div class="flex items-center justify-between gap-3">
          <div>
            <h2 class="text-sm font-semibold text-ink">Reproducibility</h2>
            <p class="text-xs text-ink-muted">Re-run this verdict under the dataset it recorded, and diff it against the current dataset.</p>
          </div>
          <BaseButton variant="soft" size="sm" :disabled="reproduceLoading" @click="verifyReproducibility">{{ reproduceLoading ? "Checking…" : "Verify reproducibility" }}</BaseButton>
        </div>
        <div v-if="reproduceResult" class="mt-3 text-sm">
          <p v-if="reproduceResult.identical" class="font-medium text-success-700">✓ Byte-identical to the recorded verdict (dataset {{ reproduceResult.recordedDatasetVersion }}).</p>
          <p v-else-if="reproduceResult.identicalModuloVersions" class="font-medium text-success-700">✓ Identical except the version stamps.</p>
          <!--
            Three statements, not two. "The decision reproduced but the bytes did not" is what an
            engine release that improves an explanation looks like, and reporting it in the same
            warning tone as a changed verdict is a false alarm on the surface a reviewer is least
            able to afford one.
          -->
          <p v-else-if="reproduceResult.decisionIdentical" class="font-medium text-success-700">
            ✓ The decision reproduced — same placards, marks, ID displays, eligibility and findings.
            <span class="font-normal text-ink-muted">{{ reproduceResult.reason }}</span>
          </p>
          <p v-else class="font-medium text-warning-700">{{ reproduceResult.reason }}</p>
          <div v-if="reproduceResult.currentDataset" class="mt-2 text-xs text-ink-secondary">
            <p class="text-ink-muted">Under the current dataset {{ reproduceResult.currentDataset.version }}:</p>
            <ul class="mt-1 space-y-0.5">
              <li v-if="reproduceResult.currentDataset.diff.placardsAdded.length">Placards added: {{ reproduceResult.currentDataset.diff.placardsAdded.join(", ") }}</li>
              <li v-if="reproduceResult.currentDataset.diff.placardsRemoved.length">Placards removed: {{ reproduceResult.currentDataset.diff.placardsRemoved.join(", ") }}</li>
              <li v-if="reproduceResult.currentDataset.diff.eligibilityBefore !== reproduceResult.currentDataset.diff.eligibilityAfter">Eligibility: {{ reproduceResult.currentDataset.diff.eligibilityBefore }} → {{ reproduceResult.currentDataset.diff.eligibilityAfter }}</li>
              <li v-if="reproduceResult.currentDataset.diff.placardsAdded.length === 0 && reproduceResult.currentDataset.diff.placardsRemoved.length === 0 && reproduceResult.currentDataset.diff.eligibilityBefore === reproduceResult.currentDataset.diff.eligibilityAfter" class="text-ink-muted">No operational change under the current dataset.</li>
            </ul>
          </div>
        </div>
      </BaseCard>
    </template>
  </div>
</template>
