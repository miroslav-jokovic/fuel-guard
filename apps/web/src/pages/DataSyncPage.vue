<script setup lang="ts">
import { computed } from "vue";
import JobActionCard from "@/features/jobs/JobActionCard.vue";
import { useJob } from "@/features/jobs/useJob";
import { useSessionStore } from "@/stores/session";

const session = useSessionStore();

// Read-only integrity summary from the nightly self-heal job.
const nightly = useJob("nightly_reconcile");
const integrity = computed(() => {
  const stats = (nightly.lastDone.value?.stats ?? {}) as { driftFixed?: number };
  const drift = stats.driftFixed;
  if (nightly.lastDone.value == null) return "No nightly check has run yet.";
  return drift === 0 || drift == null ? "No data drift found." : `${drift} row(s) of drift repaired.`;
});
</script>

<template>
  <div class="space-y-6">
    <p class="text-sm text-gray-500">
      EFS reports and telematics data are ingested automatically — new fuel reports are picked up on a
      schedule, and each import re-scores the affected vehicles so the anomaly report stays current with no
      manual step. Telematics live stats refresh every ~20 min, identity every ~12 h, and a nightly self-heal
      keeps everything consistent. Use these to force a refresh now — each shows its own freshness and live
      progress. Scoring runs through the rate-limited Samsara client, so large batches pace themselves.
    </p>

    <div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <JobActionCard
        title="Import EFS reports"
        kind="efs_ingest"
        endpoint="/api/transactions/ingest-efs"
        action-label="Check now"
        description="Pick up any EFS fuel reports delivered to the ingestion source and import them — the same batch that runs automatically. New rows are scored and the affected vehicles re-checked."
      />
      <JobActionCard
        v-if="session.admin"
        title="Sync from Samsara"
        kind="sync_vehicles"
        endpoint="/api/integrations/samsara/sync-vehicles"
        action-label="Sync now"
        description="Pull trucks, drivers and driver assignments from Samsara (identity). Runs automatically every ~12 hours."
      />
      <JobActionCard
        title="Re-sync Samsara"
        kind="backfill"
        endpoint="/api/transactions/backfill"
        action-label="Re-sync now"
        description="Reconcile only NEW / not-yet-reconciled fills against Samsara live — fast and scales with your data. New imports already reconcile themselves; this catches any that were missed."
      />
      <JobActionCard
        v-if="session.admin"
        title="Full re-reconcile"
        kind="backfill"
        endpoint="/api/transactions/backfill"
        :body="{ full: true }"
        action-label="Re-reconcile all"
        description="Re-check EVERY fill against Samsara live (slow, grows with history). Only needed after a detection-logic change that must re-touch old rows — routine syncing does not require this."
        confirm="Re-check EVERY historical fill against Samsara live? This can take a while and is only needed after a settings/logic change."
      />
      <JobActionCard
        title="Rebuild anomalies"
        kind="rebuild"
        endpoint="/api/transactions/rebuild"
        action-label="Rebuild now"
        description="Re-score every transaction with the current rules (reuses stored Samsara values — fast, no live calls). Clears stale/false flags after a rule change; your review notes are kept."
        confirm="Re-score every transaction with the current rules? Existing false flags will clear; your notes are kept."
      />
    </div>

    <!-- Data integrity (read-only) -->
    <div class="rounded-lg bg-white p-5 shadow-sm ring-1 ring-gray-200">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold text-gray-900">Data integrity</h3>
        <span class="text-xs" :class="nightly.failed.value ? 'text-red-600' : 'text-gray-400'">{{ nightly.freshnessLabel.value }}</span>
      </div>
      <p class="mt-1 text-sm text-gray-500">
        Nightly self-heal (per-org, ~03:00 local): repairs the fuel-event store from the source records, then
        re-scores and rebuilds. {{ integrity }}
      </p>
    </div>
  </div>
</template>
