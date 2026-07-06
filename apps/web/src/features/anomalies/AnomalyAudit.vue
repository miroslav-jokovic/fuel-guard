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
  tank_confirmed: { label: "Tank-confirmed", cls: "bg-green-100 text-green-700" },
  stop_estimated: { label: "Stop-estimated", cls: "bg-blue-100 text-blue-700" },
  reported: { label: "Reported time", cls: "bg-amber-100 text-amber-700" },
  date_only: { label: "Date only", cls: "bg-gray-100 text-gray-600" },
};
const basis = computed(() => BASIS[props.txn.fueling_time_basis ?? ""] ?? { label: "Not reconciled", cls: "bg-gray-100 text-gray-500" });

// ── location ────────────────────────────────────────────────────────────────────
const efsPlace = computed(() => props.txn.location_text || [props.txn.city, props.txn.state].filter(Boolean).join(", ") || "—");
const observedPlace = computed(() => {
  const t = props.txn;
  return t.samsara_observed_address || [t.samsara_observed_city, t.samsara_observed_state].filter(Boolean).join(", ") || null;
});
const CONF: Record<string, { label: string; cls: string }> = {
  gps_confirmed: { label: "GPS confirmed", cls: "text-green-700" },
  in_state: { label: "In state", cls: "text-green-700" },
  mismatch: { label: "Mismatch", cls: "text-red-700" },
  unknown: { label: "Unknown", cls: "text-gray-500" },
};
const conf = computed(() => CONF[props.txn.samsara_location_confidence ?? ""] ?? CONF.unknown!);
</script>

<template>
  <div class="space-y-4">
    <p v-if="!reconciled" class="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200">
      This fill hasn't been reconciled against Samsara yet. Run <strong>Re-sync Samsara</strong> from Settings → Data & Sync to populate these.
    </p>

    <!-- Odometer -->
    <div class="rounded-lg border border-gray-200 p-4">
      <h4 class="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Odometer — driver entry vs telematics</h4>
      <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <dt class="text-gray-500">Driver entered (report)</dt>
        <dd class="text-right font-semibold text-gray-900">{{ fmtOdo(entered) }}</dd>
        <dt class="text-gray-500">Samsara (telematics)</dt>
        <dd class="text-right text-gray-900">{{ fmtOdo(samsara) }}</dd>
        <template v-if="odometerOffset">
          <dt class="text-gray-500">Calibration offset</dt>
          <dd class="text-right text-gray-700">{{ signed(odometerOffset) }}</dd>
        </template>
        <dt class="text-gray-500">Difference</dt>
        <dd class="text-right font-semibold" :class="beyondTolerance ? 'text-red-700' : 'text-gray-900'">
          {{ signed(calibratedDiff) }}
          <span v-if="odometerOffset && rawDiff != null" class="ml-1 text-xs font-normal text-gray-400">(raw {{ signed(rawDiff) }})</span>
        </dd>
      </dl>
      <p class="mt-2 text-xs" :class="beyondTolerance ? 'text-red-600' : 'text-gray-400'">
        <template v-if="calibratedDiff == null">Not enough data to compare.</template>
        <template v-else-if="beyondTolerance">Exceeds the ±{{ TOL }} mi tolerance — the entered odometer disagrees with telematics.</template>
        <template v-else>Within the ±{{ TOL }} mi tolerance.</template>
      </p>
    </div>

    <!-- Time -->
    <div class="rounded-lg border border-gray-200 p-4">
      <div class="mb-3 flex items-center justify-between">
        <h4 class="text-xs font-semibold uppercase tracking-wide text-gray-500">Fueling time — reported vs actual</h4>
        <span :class="['inline-flex rounded px-1.5 py-0.5 text-xs font-semibold', basis.cls]">{{ basis.label }}</span>
      </div>
      <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <dt class="text-gray-500">Reported (EFS)</dt>
        <dd class="text-right text-gray-900">
          <span v-if="isDateOnly" class="text-gray-500">Date only (no time)</span>
          <span v-else>{{ fmtTz(txn.fueled_at) }}</span>
        </dd>
        <dt class="text-gray-500">Actual (telematics)</dt>
        <dd class="text-right text-gray-900">{{ fmtTz(txn.samsara_recon_at) }}</dd>
      </dl>
      <p v-if="timeDeltaLabel" class="mt-2 text-xs text-gray-500">{{ timeDeltaLabel }} · times in {{ tzLabel }}</p>
      <p v-else class="mt-2 text-xs text-gray-400">Times shown in {{ tzLabel }}.</p>
    </div>

    <!-- Location -->
    <div class="rounded-lg border border-gray-200 p-4">
      <div class="mb-3 flex items-center justify-between">
        <h4 class="text-xs font-semibold uppercase tracking-wide text-gray-500">Location — station vs where the truck was</h4>
        <span class="text-xs font-semibold" :class="conf.cls">{{ conf.label }}</span>
      </div>
      <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <dt class="text-gray-500">EFS station</dt>
        <dd class="text-right text-gray-900">{{ efsPlace }}</dd>
        <dt class="text-gray-500">Samsara observed</dt>
        <dd class="text-right text-gray-900">{{ observedPlace ?? "—" }}</dd>
      </dl>
    </div>
  </div>
</template>
