<script setup lang="ts">
import { computed } from "vue";
import { stateTimeZone } from "@fuelguard/shared";
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
function fmtTz(iso: string | null): string {
  if (!iso) return "—";
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
const fmtOdo = (n: number | null) => (n == null ? "—" : `${Math.round(n).toLocaleString()} mi`);

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

// ── location ────────────────────────────────────────────────────────────────────
const efsPlace = computed(() => props.txn.location_text || [props.txn.city, props.txn.state].filter(Boolean).join(", ") || "—");
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
</script>

<template>
  <div class="space-y-4">
    <p v-if="!reconciled" class="rounded-md bg-warning-50 px-3 py-2 text-xs text-warning-800 ring-1 ring-warning-200">
      This fill hasn't been reconciled against Samsara yet. Run <strong>Re-sync Samsara</strong> from Settings → Data & Sync to populate these.
    </p>

    <!-- Odometer -->
    <div class="rounded-lg border border-edge p-4">
      <h4 class="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">Odometer — driver entry vs telematics</h4>
      <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <dt class="text-ink-muted">Driver entered (report)</dt>
        <dd class="text-right font-semibold text-ink">{{ fmtOdo(entered) }}</dd>
        <dt class="text-ink-muted">Samsara (telematics)</dt>
        <dd class="text-right text-ink">{{ fmtOdo(samsara) }}</dd>
        <template v-if="odometerOffset">
          <dt class="text-ink-muted">Calibration offset</dt>
          <dd class="text-right text-ink-secondary">{{ signed(odometerOffset) }}</dd>
        </template>
        <dt class="text-ink-muted">Difference</dt>
        <dd class="text-right font-semibold" :class="beyondTolerance ? 'text-danger-700' : 'text-ink'">
          {{ signed(calibratedDiff) }}
          <span v-if="odometerOffset && rawDiff != null" class="ml-1 text-xs font-normal text-ink-subtle">(raw {{ signed(rawDiff) }})</span>
        </dd>
      </dl>
      <p class="mt-2 text-xs" :class="beyondTolerance ? 'text-danger-600' : 'text-ink-subtle'">
        <template v-if="calibratedDiff == null">Not enough data to compare.</template>
        <template v-else-if="beyondTolerance">Exceeds the ±{{ TOL }} mi tolerance — the entered odometer disagrees with telematics.</template>
        <template v-else>Within the ±{{ TOL }} mi tolerance.</template>
      </p>
    </div>

    <!-- Time -->
    <div class="rounded-lg border border-edge p-4">
      <div class="mb-3 flex items-center justify-between">
        <h4 class="text-xs font-semibold uppercase tracking-wide text-ink-muted">Fueling time — reported vs actual</h4>
        <span :class="['inline-flex rounded px-1.5 py-0.5 text-xs font-semibold', basis.cls]">{{ basis.label }}</span>
      </div>
      <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <dt class="text-ink-muted">Reported (EFS)</dt>
        <dd class="text-right text-ink">
          <span v-if="isDateOnly" class="text-ink-muted">Date only (no time)</span>
          <span v-else>{{ fmtTz(txn.fueled_at) }}</span>
        </dd>
        <dt class="text-ink-muted">Actual (telematics)</dt>
        <dd class="text-right text-ink">{{ fmtTz(txn.samsara_recon_at) }}</dd>
      </dl>
      <p v-if="timeDeltaLabel" class="mt-2 text-xs text-ink-muted">{{ timeDeltaLabel }} · times in {{ tzLabel }}</p>
      <p v-else class="mt-2 text-xs text-ink-subtle">Times shown in {{ tzLabel }}.</p>
    </div>

    <!-- Location -->
    <div class="rounded-lg border border-edge p-4">
      <div class="mb-3 flex items-center justify-between">
        <h4 class="text-xs font-semibold uppercase tracking-wide text-ink-muted">Location — station vs where the truck was</h4>
        <span class="text-xs font-semibold" :class="conf.cls">{{ conf.label }}</span>
      </div>
      <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <dt class="text-ink-muted">EFS station</dt>
        <dd class="text-right text-ink">{{ efsPlace }}</dd>
        <dt class="text-ink-muted">Samsara observed</dt>
        <dd class="text-right text-ink">{{ observedPlace ?? "—" }}</dd>
      </dl>
    </div>
  </div>
</template>
