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
      Telematics data refreshes automatically (live stats every ~20 min, identity every ~12 h) and a nightly
      self-heal keeps the anomaly report consistent. Use these when you want to force a refresh now —
      each shows its own freshness and live progress.
    </p>

    <div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
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
        description="Re-check every fill against Samsara live — recomputes exact fueling location + odometer, fixing false location/odometer flags. Slower (a few minutes)."
        confirm="Re-check every fill against Samsara live? It recomputes location + odometer for all fills and takes a few minutes in the background."
      />
      <JobActionCard
        title="Rebuild anomalies"
        kind="rebuild"
        endpoint="/api/transactions/rebuild"
        action-label="Rebuild now"
        description="Re-score every transaction with the current rules (reuses stored Samsara values — fast). Clears stale/false flags; your review notes are kept."
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
