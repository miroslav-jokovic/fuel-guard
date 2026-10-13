<script setup lang="ts">
import { computed } from "vue";
import { stateTimeZone } from "@silvicom/shared";
import { AppCallout } from "@silvicom/ui";
import FactList, { type Fact } from "@/components/ui/FactList.vue";
import type { AnomalyTxnDetail } from "./useAnomalies";

const props = defineProps<{
  txn: AnomalyTxnDetail;
  odometerOffset: number; // vehicle's learned/overridden dash↔Samsara calibration
  tz: string | null; // org operating timezone (fallback)
  odometerToleranceMiles?: number;
}>();

const TOL = computed(() => props.odometerToleranceMiles ?? 10);

// Show times in the STATION's timezone so the reported time matches the paper EFS report (the stored
// fueled_at is that station-local wall time in UTC). Fall back to the org tz, then the browser.
const displayTz = computed(() => stateTimeZone(props.txn.state) ?? props.tz ?? null);
// A missing time is null, not a hand-written dash: FactList draws the blank (D-US6).
function fmtTz(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: displayTz.value ?? undefined,
      month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleString();
  }
}
const tzLabel = computed(() => displayTz.value ?? "local time");

/** EFS date-only rows carry a noon-UTC sentinel — not a real time-of-day. */
const isDateOnly = computed(() => {
  const d = new Date(props.txn.fueled_at);
  return d.getUTCHours() === 12 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0;
});

// ── odometer ────────────────────────────────────────────────────────────────────
const entered = computed(() => (props.txn.odometer != null ? Number(props.txn.odometer) : null));
const samsara = computed(() => (props.txn.samsara_odometer != null ? Number(props.txn.samsara_odometer) : null));
const reconciled = computed(() => samsara.value != null || props.txn.samsara_recon_at != null);
const rawDiff = computed(() => (entered.value != null && samsara.value != null ? entered.value - samsara.value : null));
const calibratedDiff = computed(() =>
  entered.value != null && samsara.value != null ? entered.value - (samsara.value + props.odometerOffset) : null,
);
const beyondTolerance = computed(() => calibratedDiff.value != null && Math.abs(calibratedDiff.value) > TOL.value);
const signed = (n: number | null) => (n == null ? "—" : `${n > 0 ? "+" : ""}${Math.round(n).toLocaleString()} mi`);
const fmtOdo = (n: number | null) => (n == null ? null : `${Math.round(n).toLocaleString()} mi`);

// ── time ──────────────────────────────────────────────────────────────────────
const timeDeltaLabel = computed(() => {
  if (!props.txn.samsara_recon_at || isDateOnly.value) return null;
  const mins = Math.round((new Date(props.txn.fueled_at).getTime() - new Date(props.txn.samsara_recon_at).getTime()) / 60000);
  if (Math.abs(mins) < 2) return "matches the reported time";
  const ahead = mins > 0 ? "after" : "before";
  const a = Math.abs(mins);
  const span = a >= 60 ? `${Math.round(a / 60)}h` : `${a} min`;
  return `reported time is ${span} ${ahead} the actual fueling`;
});

const BASIS: Record<string, { label: string; cls: string }> = {
  tank_confirmed: { label: "Tank-confirmed", cls: "bg-success-100 text-success-700" },
  stop_estimated: { label: "Stop-estimated", cls: "bg-info-100 text-info-700" },
  reported: { label: "Reported time", cls: "bg-warning-100 text-warning-700" },
  date_only: { label: "Date only", cls: "bg-surface-muted text-ink-secondary" },
};
const basis = computed(() => BASIS[props.txn.fueling_time_basis ?? ""] ?? { label: "Not reconciled", cls: "bg-surface-muted text-ink-muted" });
const reconStatus = computed(() => props.txn.samsara_recon_status ?? (reconciled.value ? "success" : "skipped"));
const reconCheckedLabel = computed(() => props.txn.samsara_recon_checked_at ? fmtTz(props.txn.samsara_recon_checked_at) : null);

// ── location ────────────────────────────────────────────────────────────────────
const efsPlace = computed(() => props.txn.location_text || [props.txn.city, props.txn.state].filter(Boolean).join(", ") || null);
const observedPlace = computed(() => {
  const t = props.txn;
  return t.samsara_observed_address || [t.samsara_observed_city, t.samsara_observed_state].filter(Boolean).join(", ") || null;
});
const CONF: Record<string, { label: string; cls: string }> = {
  gps_confirmed: { label: "GPS confirmed", cls: "text-success-700" },
  in_state: { label: "In state", cls: "text-success-700" },
  mismatch: { label: "Mismatch", cls: "text-danger-700" },
  unknown: { label: "Unknown", cls: "text-ink-muted" },
};
const conf = computed(() => CONF[props.txn.samsara_location_confidence ?? ""] ?? CONF.unknown!);

// ── the three fact lists (D-US6) ───────────────────────────────────────────────────
// The difference keeps its danger tone past the tolerance; the raw figure rides beside it through
// the `value-diff` slot only when a calibration offset makes the two differ.
const odometerFacts = computed<Fact[]>(() => [
  { label: "Driver entered (report)", value: fmtOdo(entered.value), numeric: true },
  { label: "Samsara (telematics)", value: fmtOdo(samsara.value), numeric: true },
  ...(props.odometerOffset ? [{ label: "Calibration offset", value: signed(props.odometerOffset), numeric: true }] : []),
  {
    key: "diff",
    label: "Difference",
    value: calibratedDiff.value != null ? signed(calibratedDiff.value) : null,
    numeric: true,
    ...(beyondTolerance.value ? { tone: "text-danger-700" } : {}),
  },
]);
const timeFacts = computed<Fact[]>(() => [
  isDateOnly.value
    ? { label: "Reported (EFS)", value: "Date only (no time)", tone: "text-ink-muted" }
    : { label: "Reported (EFS)", value: fmtTz(props.txn.fueled_at) },
  { label: "Actual (telematics)", value: fmtTz(props.txn.samsara_recon_at) },
]);
const locationFacts = computed<Fact[]>(() => [
  { label: "EFS station", value: efsPlace.value },
  { label: "Samsara observed", value: observedPlace.value },
]);
</script>

<template>
  <div class="space-y-4">
    <AppCallout v-if="!reconciled" tone="warning">
      This fill hasn't been reconciled against Samsara yet. Run <strong>Re-sync Samsara</strong> from Settings → Data & Sync to populate these.
    </AppCallout>
    <AppCallout v-else-if="reconStatus === 'failed'" tone="warning">
      The latest Samsara refresh failed{{ reconCheckedLabel ? ` at ${reconCheckedLabel}` : "" }}. Previously stored telemetry evidence was preserved.
    </AppCallout>
    <p v-else-if="reconStatus === 'no_data'" class="rounded-control bg-surface-muted px-3 py-2 text-xs text-ink-secondary ring-1 ring-edge">
      Samsara returned no data on the latest refresh{{ reconCheckedLabel ? ` at ${reconCheckedLabel}` : "" }}. Previously stored telemetry evidence was preserved.
    </p>

    <!-- Odometer -->
    <div class="rounded-surface border border-edge p-4">
      <h4 class="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">Odometer — driver entry vs telematics</h4>
      <FactList layout="rows" :facts="odometerFacts">
        <template v-if="odometerOffset && rawDiff != null" #value-diff="{ fact }">
          {{ fact.value }}
          <span class="ml-1 text-xs font-normal text-ink-tertiary">(raw {{ signed(rawDiff) }})</span>
        </template>
      </FactList>
      <p class="mt-2 text-xs" :class="beyondTolerance ? 'text-danger-600' : 'text-ink-tertiary'">
        <template v-if="calibratedDiff == null">Not enough data to compare.</template>
        <template v-else-if="beyondTolerance">Exceeds the ±{{ TOL }} mi tolerance — the entered odometer disagrees with telematics.</template>
        <template v-else>Within the ±{{ TOL }} mi tolerance.</template>
      </p>
    </div>

    <!-- Time -->
    <div class="rounded-surface border border-edge p-4">
      <div class="mb-3 flex items-center justify-between">
        <h4 class="text-xs font-semibold uppercase tracking-wide text-ink-muted">Fueling time — reported vs actual</h4>
        <span :class="['inline-flex rounded-control px-1.5 py-0.5 text-xs font-semibold', basis.cls]">{{ basis.label }}</span>
      </div>
      <FactList layout="rows" :facts="timeFacts" />
      <p v-if="timeDeltaLabel" class="mt-2 text-xs text-ink-muted">{{ timeDeltaLabel }} · times in {{ tzLabel }}</p>
      <p v-else class="mt-2 text-xs text-ink-tertiary">Times shown in {{ tzLabel }}.</p>
    </div>

    <!-- Location -->
    <div class="rounded-surface border border-edge p-4">
      <div class="mb-3 flex items-center justify-between">
        <h4 class="text-xs font-semibold uppercase tracking-wide text-ink-muted">Location — station vs where the truck was</h4>
        <span class="text-xs font-semibold" :class="conf.cls">{{ conf.label }}</span>
      </div>
      <FactList layout="rows" :facts="locationFacts" />
    </div>
  </div>
</template>
