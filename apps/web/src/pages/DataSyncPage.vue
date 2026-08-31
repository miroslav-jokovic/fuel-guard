<script setup lang="ts">
import { computed, ref } from "vue";
import { apiFetch } from "@/lib/api";
import { AppButton as BaseButton } from "@silvicom/ui";
import JobActionCard from "@/features/jobs/JobActionCard.vue";
import { useJob } from "@/features/jobs/useJob";
import { useSessionStore } from "@/stores/session";
import { AppCard as BaseCard } from "@silvicom/ui";
import PageHeader from "@/components/ui/PageHeader.vue";

const session = useSessionStore();

// Admin-only Samsara diagnostics: probes each Samsara endpoint (incl. HOS) and shows the raw status + shape,
// so we can see exactly what Samsara returns without guessing at the response fields.
const diag = ref<unknown>(null);
const diagRunning = ref(false);
const diagError = ref<string | null>(null);
async function runDiagnostics() {
  diagRunning.value = true;
  diagError.value = null;
  try {
    const res = await apiFetch("/api/integrations/samsara/diagnostics", { method: "POST" });
    if (res.ok) diag.value = res.data;
    else diagError.value = res.error?.message ?? "Diagnostics failed";
  } finally {
    diagRunning.value = false;
  }
}
const diagJson = computed(() => (diag.value ? JSON.stringify(diag.value, null, 2) : ""));

// Read-only integrity summary from the nightly self-heal job.
const nightly = useJob("nightly_reconcile");
/** Turn the last efs_ingest run's stats into a plain outcome line so a "successful" sync that imported
 *  nothing (all quarantined, or none found) is visible instead of a silent green chip. */
function efsSummary(stats: Record<string, unknown>) {
  const n = (v: unknown) => Number(v ?? 0);
  const found = n(stats.found),
    ingested = n(stats.ingested),
    empty = n(stats.empty);
  const quarantined = n(stats.quarantined),
    errored = n(stats.errored),
    markDoneFailed = n(stats.markDoneFailed);
  const outcomes = (Array.isArray(stats.outcomes) ? stats.outcomes : []) as Array<{
    status?: string;
    reason?: string;
  }>;
  if (found === 0)
    return { label: "Last check: no new report emails found in the mailbox.", warn: false };
  const parts = [`${found} found`, `${ingested} imported`];
  if (empty) parts.push(`${empty} empty`);
  if (quarantined) parts.push(`${quarantined} unrecognized/unreadable`);
  if (errored) parts.push(`${errored} errored`);
  // Surface the actual failure reason (not just a count) so the cause is visible on the card.
  const problem = outcomes.find((o) => o.status === "errored" || o.status === "quarantined");
  const reason = problem?.reason ? ` — ${String(problem.reason).slice(0, 240)}` : "";
  let label = `Last check: ${parts.join(", ")}.${reason}`;
  if (markDoneFailed > 0)
    label += ` (Imported, but couldn't mark ${markDoneFailed} email(s) read — grant Mail.ReadWrite so they aren't re-checked each run.)`;
  const warn = ingested === 0 || quarantined > 0 || errored > 0 || markDoneFailed > 0;
  return { label, warn };
}

const integrity = computed(() => {
  const stats = (nightly.lastDone.value?.stats ?? {}) as { driftFixed?: number };
  const drift = stats.driftFixed;
  if (nightly.lastDone.value == null) return "No nightly check has run yet.";
  return drift === 0 || drift == null
    ? "No data drift found."
    : `${drift} row(s) of drift repaired.`;
});
</script>

<template>
  <div class="space-y-6">
    <PageHeader>
      EFS reports and telematics data are ingested automatically — new fuel reports are picked up on
      a schedule, and each import re-scores the affected vehicles so the anomaly report stays
      current with no manual step. Telematics live stats refresh every ~20 min, identity every ~12
      h, and a nightly self-heal keeps everything consistent. Use these to force a refresh now —
      each shows its own freshness and live progress. Scoring runs through the rate-limited Samsara
      client, so large batches pace themselves.
    </PageHeader>

    <div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <JobActionCard
        title="Import EFS reports"
        kind="efs_ingest"
        endpoint="/api/transactions/ingest-efs"
        action-label="Check now"
        :result-summary="efsSummary"
        description="Pick up any EFS fuel reports delivered to the ingestion source and import them — the same batch that runs automatically. New rows are scored and the affected vehicles re-checked."
      />
      <JobActionCard
        v-if="session.admin"
        title="Sync fleet identity"
        kind="sync_vehicles"
        endpoint="/api/integrations/samsara/sync-vehicles"
        action-label="Sync now"
        description="Pull trucks, drivers, trailers and their Samsara IDs from Samsara. This is the identity link that lets fuel fills be reconciled. Runs automatically every ~12 hours."
      />
      <JobActionCard
        v-if="session.admin"
        title="Sync drivers"
        kind="sync_drivers"
        endpoint="/api/integrations/samsara/sync-drivers"
        action-label="Sync drivers now"
        description="Pull the driver roster from Samsara into the Drivers page — names, phone numbers and the alpha-code Driver ID. Also runs with 'Sync fleet identity'."
      />
      <JobActionCard
        v-if="session.admin"
        title="Sync trailers"
        kind="sync_trailers"
        endpoint="/api/integrations/samsara/sync-trailers"
        action-label="Sync trailers now"
        description="Pull the reefer/trailer assets and their tractor pairings from Samsara. Also runs with 'Sync fleet identity'."
      />
      <JobActionCard
        title="Reconcile fuel with telematics"
        kind="backfill"
        endpoint="/api/transactions/backfill"
        action-label="Reconcile new fills"
        :secondary-label="session.admin ? 'Re-check all history' : undefined"
        :secondary-body="{ full: true }"
        secondary-confirm="Re-check EVERY historical fill against Samsara live? Slower — only needed after a detection-logic change."
        description="Match fuel-card fills to Samsara — location, fueling-time odometer and tank level. 'Reconcile new fills' catches any not-yet-reconciled rows (fast). 'Re-check all history' re-touches every fill (only after a logic change)."
      />
      <JobActionCard
        title="Rebuild anomalies"
        kind="rebuild"
        endpoint="/api/transactions/rebuild"
        action-label="Rebuild recent (30 days)"
        :body="{ sinceDays: 30 }"
        secondary-label="Rebuild all history"
        :secondary-body="{}"
        secondary-confirm="Re-score EVERY transaction in your history? Slower — only needed after a broad rule change. Existing false flags clear; your notes are kept."
        description="New uploads already score automatically — you don't need to rebuild after a routine upload. Use 'Rebuild recent' to re-apply the current rules to the last 30 days (fast); 'Rebuild all history' re-scores everything. Your review notes are kept."
        confirm="Re-score the last 30 days with the current rules? Existing false flags will clear; your notes are kept."
      />
      <JobActionCard
        v-if="session.can('settings')"
        title="Sync idling events"
        kind="sync_idle"
        endpoint="/api/integrations/samsara/sync-idle"
        action-label="Sync idling now"
        secondary-label="Backfill last 120 days"
        :secondary-body="{ sinceDays: 120 }"
        secondary-confirm="Backfill 120 days of idle history? Runs in 30-day slices (roughly an hour total) and unlocks longer Idling date ranges plus temperature-envelope learning for Optimized Idle trucks. Run 'Backfill last 120 days' on the HOS card FIRST so the rest-vs-work split has matching history."
        description="Pull the last 30 days of Samsara idling events and refresh the driver idle scorecard. 'Backfill last 120 days' seeds deeper history in 30-day slices. Also runs with 'Sync fleet identity'. Needs the token's Read Idling scope."
      />
      <JobActionCard
        v-if="session.can('settings')"
        title="Sync HOS duty status"
        kind="sync_hos"
        endpoint="/api/integrations/samsara/sync-hos"
        action-label="Sync HOS now"
        secondary-label="Backfill last 120 days"
        :secondary-body="{ sinceDays: 120 }"
        secondary-confirm="Pull 120 days of Samsara HOS duty-status logs? Slower — usually only needed once to seed history."
        description="Pull driver Hours-of-Service duty status (Sleeper Berth / Off Duty / On Duty) from Samsara. Powers the rest-vs-work idle split on the Idling page. 'Sync HOS now' pulls a rolling 30 days; 'Backfill last 120 days' seeds history. Also runs on the scheduled sync. Needs the token's Read ELD Compliance scope."
      />
      <JobActionCard
        v-if="session.can('settings')"
        title="Sync driver scores"
        kind="sync_driver_scores"
        endpoint="/api/integrations/samsara/sync-driver-scores"
        action-label="Sync scores now"
        description="Refresh this week's Safety + Efficiency driver scores from Samsara and the idle scorecard. Runs automatically on a schedule."
      />
    </div>

    <!-- Samsara diagnostics (admin, read-only): raw endpoint status + response shapes, incl. HOS. -->
    <BaseCard v-if="session.admin">
      <div class="flex items-center justify-between">
        <div>
          <h3 class="text-sm font-semibold text-ink">Samsara diagnostics</h3>
          <p class="mt-1 text-sm text-ink-muted">
            Probe every Samsara endpoint (incl. HOS logs + clocks) and show the raw status and
            response shape. Read-only — no data is written.
          </p>
        </div>
        <BaseButton :disabled="diagRunning" @click="runDiagnostics">{{
          diagRunning ? "Running…" : "Run diagnostics"
        }}</BaseButton>
      </div>
      <p v-if="diagError" class="mt-2 text-sm text-danger-600">{{ diagError }}</p>
      <pre
        v-if="diagJson"
        class="mt-3 max-h-96 overflow-auto rounded-control bg-surface-muted p-3 text-xs text-ink-secondary"
        >{{ diagJson }}</pre>
    </BaseCard>

    <!-- Data integrity (read-only) -->
    <BaseCard>
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold text-ink">Data integrity</h3>
        <span
          class="text-xs"
          :class="nightly.failed.value ? 'text-danger-600' : 'text-ink-tertiary'"
          >{{ nightly.freshnessLabel.value }}</span
        >
      </div>
      <p class="mt-1 text-sm text-ink-muted">
        Nightly self-heal (per-org, ~03:00 local): repairs the fuel-event store from the source
        records, then re-scores and rebuilds. {{ integrity }}
      </p>
    </BaseCard>
  </div>
</template>
