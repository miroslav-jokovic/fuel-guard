<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { apiFetch } from "@/lib/api";
import { AppButton as BaseButton } from "@silvicom/ui";
import JobActionCard from "@/features/jobs/JobActionCard.vue";
import { useJob } from "@/features/jobs/useJob";
import { useSessionStore } from "@/stores/session";
import { AppCard as BaseCard } from "@silvicom/ui";
import PageHeader from "@/components/ui/PageHeader.vue";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import { formatDateTime } from "@/lib/format";

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

/**
 * Samsara webhook readiness (SAMSARA-COLLECTION-PLAN S1).
 *
 * The sudden-fuel-drop receiver had been unreachable since it was built — the vendor console pointed
 * at the mount prefix rather than the route, and the signing secret was never set, so it answered 401
 * to anything that did arrive. Neither end complained, and `fuel_events` sat at 0 rows for six months
 * looking exactly like a fleet with no siphoning. Both fixes are console/Railway settings; what
 * belongs here is the part that was actually missing, which is any way to SEE it from the product.
 *
 * The counts are all-time on purpose (D-SAM7): a windowed zero reads as a quiet week, and the state
 * worth catching is a receiver that has never been reachable at all.
 */
interface WebhookStatus {
  secretConfigured: boolean;
  endpointPath: string;
  endpointUrl: string | null;
  eventCount: number;
  lastEventAt: string | null;
}
const webhook = ref<WebhookStatus | null>(null);
const webhookError = ref<string | null>(null);
onMounted(async () => {
  const res = await apiFetch<WebhookStatus>("/api/integrations/samsara/webhook");
  if (res.ok) webhook.value = res.data ?? null;
  else webhookError.value = res.error?.message ?? "Could not read the webhook status";
});

/**
 * Telematics history coverage (SAMSARA-COLLECTION-PLAN S4, D-SAM7).
 *
 * ⚠ ALL-TIME, and it has no window control ON PURPOSE. The Coverage page shows the same idea over 90
 * days and reads ~95%; across the whole history the figure was 23%, because 76.8% of fills had never
 * had telematics fetched at all. Both were true and one was useless — a coverage figure whose scope
 * hides the gap turns an unanswered question into a reassuring answer.
 *
 * The three states are shown apart because they need different actions and only one of them improves
 * by waiting: **corroborated**, **no history at Samsara** (a permanent answer), and **not fetched yet**
 * (the collector tier is still working through these, oldest first).
 */
interface CoverageMonth {
  month: string;
  fills: number;
  reconciled: number;
  noData: number;
  pending: number;
  coveragePct: number;
}
interface TelematicsCoverage {
  fills: number;
  reconciled: number;
  noData: number;
  pending: number;
  coveragePct: number;
  attainablePct: number | null;
  truncated: boolean;
  byMonth: CoverageMonth[];
}
const coverage = ref<TelematicsCoverage | null>(null);
const coverageError = ref<string | null>(null);
onMounted(async () => {
  const res = await apiFetch<TelematicsCoverage>("/api/integrations/samsara/telematics-coverage");
  if (res.ok) coverage.value = res.data ?? null;
  else coverageError.value = res.error?.message ?? "Could not read telematics coverage";
});

const monthLabel = (m: string) => {
  const [y, mm] = m.split("-");
  return new Date(Number(y), Number(mm) - 1, 1).toLocaleDateString(undefined, {
    month: "short",
    year: "numeric",
  });
};
const covTone = (p: number) =>
  p >= 85 ? "text-success-700" : p >= 50 ? "text-warning-600" : "text-danger-700";

/** Each state gets its own column because each needs a different action — see the block comment above. */
const coverageColumns: DataTableColumn[] = [
  { key: "month", label: "Month", cellClass: "font-medium text-ink" },
  { key: "fills", label: "Fills", numeric: true, cellClass: "text-ink-secondary" },
  { key: "reconciled", label: "Checked", numeric: true, cellClass: "text-ink-secondary" },
  { key: "noData", label: "No history", numeric: true },
  { key: "pending", label: "To fetch", numeric: true },
  { key: "coveragePct", label: "Covered", numeric: true },
];

/** Plain word first, mechanism second — the state an operator has to act on, in one line. */
const webhookState = computed(() => {
  const w = webhook.value;
  if (!w) return null;
  if (!w.secretConfigured)
    return {
      warn: true,
      label: "Not receiving — the signing secret is missing, so every delivery is rejected.",
      detail: "Set SAMSARA_WEBHOOK_SECRET (from the Samsara webhook config) on the API service and restart.",
    };
  if (w.eventCount === 0)
    return {
      warn: true,
      label: "Configured, but no event has ever arrived.",
      detail: "Check that the Samsara webhook posts to the address below and is subscribed to the sudden fuel-level drop alert.",
    };
  return {
    warn: false,
    label: `Last event ${formatDateTime(w.lastEventAt)}.`,
    detail: `${w.eventCount} event(s) received in total.`,
  };
});

// Read-only integrity summary from the nightly self-heal job.
const nightly = useJob("nightly_reconcile");

/**
 * FUEL-C4, D-FUI3 — "Repair fuel data" moved here from `/import`, which is gone.
 *
 * It belongs on this page because this is where the other repair actions already are, and it was
 * only ever on the import page because the import page was where somebody first needed it. Two
 * things changed with the address, both improvements the move made free:
 *
 * · **It gets progress and freshness.** The route has ALWAYS created a job (`efs_store_sync`, and
 *   it 409s while one is running), but the old button ignored that and reported a toast — so a
 *   repair that was still re-scoring in the background looked finished, and a second click looked
 *   broken. `JobActionCard` polls the ledger the route already writes.
 * · **It says what the last run did**, in the same shape every other card on this page does.
 *
 * ⚠ **It keeps `can("fuel")` and does NOT inherit this page's `manage("settings")`.** The route is
 * `requireSection("fuel")` — manage — and in the shipped matrix `settings: manage` and
 * `fuel: manage` happen to be the same two roles, so nothing changes today. They are separately
 * overridable per org (D-PERM2), and an org that grants settings without fuel would otherwise see a
 * button that 403s.
 */
function repairSummary(stats: Record<string, unknown>) {
  const n = (v: unknown) => Number(v ?? 0);
  const inserted = n(stats.inserted), updated = n(stats.updated), unchanged = n(stats.unchanged);
  if (inserted === 0 && updated === 0) {
    return { label: `Last run: all ${unchanged} fuel events already matched the stored EFS lines.`, warn: false };
  }
  return { label: `Last run: ${inserted} added, ${updated} corrected, ${unchanged} already correct.`, warn: true };
}
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
        v-if="session.can('fuel')"
        title="Repair fuel data"
        kind="efs_store_sync"
        endpoint="/api/transactions/sync-from-efs"
        action-label="Repair now"
        :result-summary="repairSummary"
        description="If the Fuel Log's source records show all your EFS data but dashboard graphs are missing days, the derived fuel events are out of sync with the stored report lines. This rebuilds them from the stored data — no file re-upload needed. Safe to run any time; it only adds or corrects rows."
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

    <!-- Telematics history: how much of the WHOLE history the collector has corroborated (S4, D-SAM7). -->
    <BaseCard>
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold text-ink">Telematics history</h3>
        <span v-if="coverage" class="text-2xl font-bold" :class="covTone(coverage.coveragePct)">
          {{ coverage.coveragePct }}%
        </span>
      </div>
      <p class="mt-1 text-sm text-ink-muted">
        How many of this carrier's fuel purchases we have been able to check against what the truck's
        telematics actually recorded. This counts every fill we hold, not a recent window — a figure
        that only looks at the last few months would read healthy while years of history sat
        unchecked.
      </p>
      <p v-if="coverageError" class="mt-2 text-sm text-danger-600">{{ coverageError }}</p>
      <template v-else-if="coverage">
        <p class="mt-2 text-sm text-ink-secondary">
          {{ coverage.reconciled.toLocaleString() }} of {{ coverage.fills.toLocaleString() }} fills
          checked.
          <template v-if="coverage.pending">
            {{ coverage.pending.toLocaleString() }} still to fetch — the collector works through these
            oldest-first, on its own schedule, and nobody needs to start it.
          </template>
          <template v-if="coverage.noData">
            {{ coverage.noData.toLocaleString() }} came back with nothing on Samsara's side; those do
            not improve by waiting.
          </template>
        </p>
        <p v-if="coverage.attainablePct !== null && coverage.pending" class="mt-1 text-sm text-ink-tertiary">
          At the rate the fills already checked came back, this lands near
          <strong class="text-ink-secondary">{{ coverage.attainablePct }}%</strong> once the backlog
          clears.
        </p>
        <p v-if="coverage.truncated" class="mt-1 text-sm text-warning-600">
          Only the most recent fills were read, so this is a floor rather than the whole figure.
        </p>

        <div v-if="coverage.byMonth.length" class="mt-4">
          <DataTable :columns="coverageColumns" :rows="coverage.byMonth" row-key="month">
            <template #cell-month="{ row }">{{ monthLabel(row.month) }}</template>
            <template #cell-noData="{ row }">
              <span :class="row.noData ? 'text-warning-600' : 'text-ink-tertiary'">{{ row.noData.toLocaleString() }}</span>
            </template>
            <template #cell-pending="{ row }">
              <span :class="row.pending ? 'text-ink-secondary' : 'text-ink-tertiary'">{{ row.pending.toLocaleString() }}</span>
            </template>
            <template #cell-coveragePct="{ row }">
              <span class="font-medium" :class="covTone(row.coveragePct)">{{ row.coveragePct }}%</span>
            </template>
          </DataTable>
        </div>
        <p class="mt-2 text-xs text-ink-tertiary">
          Every month we hold a fill for is listed — nothing is hidden, which is the point.
        </p>
      </template>
    </BaseCard>

    <!-- Samsara webhook: is the sudden-fuel-drop receiver configured, and has it ever heard anything? -->
    <BaseCard>
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold text-ink">Fuel-drop webhook</h3>
        <span
          v-if="webhookState"
          class="text-xs"
          :class="webhookState.warn ? 'text-danger-600' : 'text-ink-tertiary'"
          >{{ webhookState.label }}</span
        >
      </div>
      <p class="mt-1 text-sm text-ink-muted">
        Samsara calls us the moment a truck's fuel level drops suddenly — fuel leaving the tank with
        no purchase behind it. This is push, not a scheduled pull, so it either works or it is
        silent; there is no partial state to notice.
      </p>
      <p v-if="webhookError" class="mt-2 text-sm text-danger-600">{{ webhookError }}</p>
      <p v-else-if="webhookState" class="mt-2 text-sm text-ink-secondary">
        {{ webhookState.detail }}
      </p>
      <p v-if="webhook" class="mt-2 text-xs text-ink-tertiary">
        Samsara must post to
        <code class="rounded-control bg-surface-muted px-1 py-0.5 text-ink-secondary">{{
          webhook.endpointUrl ?? webhook.endpointPath
        }}</code>
      </p>
    </BaseCard>

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
