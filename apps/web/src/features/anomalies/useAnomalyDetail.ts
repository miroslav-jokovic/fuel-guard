import { ref, computed } from "vue";
import { ANOMALY_DISPOSITIONS, DISPOSITION_LABELS, type Anomaly, type AnomalyDisposition } from "@fuelguard/shared";
import { useTransaction, useAnomalyTransition, useRelatedCardFills } from "./useAnomalies";
import { useVehiclesQuery } from "@/composables/useVehicles";
import { useDriversQuery } from "@/composables/useDrivers";
import { useAiVerification, useAiExamine } from "@/features/ai/useAiVerification";
import { stationDateTime } from "@/lib/stationTime";
import { useOrgSettingsQuery } from "@/composables/useOrgSettings";
import { useToastStore } from "@/stores/toast";

/** Logic for AnomalyDetail.vue — data fetching, evidence parsing, lookups, formatting, and workflow. */
export function useAnomalyDetail(
  props: { anomaly: Anomaly; vehicleUnit: string },
  emit: (e: "changed") => void,
) {
// ── data fetching ────────────────────────────────────────────────────────────
const txnId = computed(() => props.anomaly.transaction_id);
const { data: txn } = useTransaction(txnId);
const { data: assessment, isFetching: aiLoading } = useAiVerification(txnId);
const aiExamine = useAiExamine();
const transition = useAnomalyTransition();
const { data: vehicles } = useVehiclesQuery();
const { data: drivers } = useDriversQuery();

// ── evidence / signal parsing ────────────────────────────────────────────────
interface CaseSignal { ruleId: string; axis: string; weight: number; severity: string; message: string }
const ev = computed(() => (props.anomaly.evidence ?? {}) as Record<string, unknown>);
const caseSignals = computed<CaseSignal[]>(() =>
  Array.isArray(ev.value.signals) ? (ev.value.signals as CaseSignal[]) : [],
);
const isCase = computed(() => caseSignals.value.length > 0);
const caseScore  = computed(() => ev.value.score  as number   | undefined);
const caseLevel  = computed(() => ev.value.level  as string   | undefined);
const caseAxes   = computed(() => (ev.value.axes  as string[] | undefined) ?? []);
const evidenceRows = computed(() =>
  Object.entries(ev.value).filter(([k]) => !["signals", "level", "score", "axes"].includes(k)),
);

// ── card multi-vehicle / sibling fills ───────────────────────────────────────
const hasCardSignal = computed(
  () =>
    props.anomaly.rule_id === "card_multi_vehicle" ||
    caseSignals.value.some((s) => s.ruleId === "card_multi_vehicle"),
);
const cardRef    = computed(() => txn.value?.card_ref ?? null);
const fueledAt   = computed(() => txn.value?.fueled_at ?? undefined);
const windowHours = computed(() => {
  if (props.anomaly.rule_id === "card_multi_vehicle")
    return Number(ev.value.windowHours ?? 48);
  return 48;
});
const { data: siblingFills, isLoading: siblingLoading } = useRelatedCardFills(
  cardRef,
  fueledAt,
  txnId,
  windowHours,
);

// ── lookup helpers ────────────────────────────────────────────────────────────
const vehicleById = (id: string | null) =>
  id ? (vehicles.value?.find((v) => v.id === id) ?? null) : null;
const driverName  = (id: string | null) =>
  id ? (drivers.value?.find((d) => d.id === id)?.full_name ?? "—") : "—";
const unitNumber  = (id: string | null) =>
  id ? (vehicleById(id)?.unit_number ?? "—") : "Unattributed";
const vehicleDesc = (id: string | null) => {
  const v = vehicleById(id);
  return v ? [v.year, v.make, v.model].filter(Boolean).join(" ") : "";
};

// ── audit tab (odometer / time / location precision) ───────────────────────────
const tab = ref<"overview" | "audit">("overview");
const { data: org } = useOrgSettingsQuery();
const orgTz = computed(() => (org.value?.operating_hours as { tz?: string } | null)?.tz ?? null);
const odometerOffset = computed(() => Number(vehicleById(txn.value?.vehicle_id ?? null)?.odometer_offset ?? 0));

// ── styling helpers ───────────────────────────────────────────────────────────
const axisClass = (axis: string): string => {
  const map: Record<string, string> = {
    location:    "bg-caution-100 text-caution-700",
    volume:      "bg-danger-100 text-danger-700",
    consumption: "bg-warning-100 text-warning-700",
    odometer:    "bg-brand-100 text-brand-700",
    behavior:    "bg-info-100 text-info-700",
    reefer:      "bg-info-100 text-info-700",
  };
  return map[axis] ?? "bg-surface-muted text-ink-secondary";
};
const weightBarClass = (w: number): string => {
  if (w >= 75) return "bg-danger-500";
  if (w >= 50) return "bg-caution-400";
  if (w >= 25) return "bg-warning-400";
  return "bg-neutral-300";
};

// ── formatting ────────────────────────────────────────────────────────────────
// Fueling times render in the STATION's local timezone so they match the printed EFS report.
const fmt = (iso: string, state: string | null) => stationDateTime(iso, state);
const fmtShort = (iso: string, state: string | null) => stationDateTime(iso, state, { short: true });
const fmtOdo  = (n: number | null) => (n != null ? n.toLocaleString() + " mi" : "—");
const fmtMoney = (n: number | null, prefix = "$") => (n != null ? prefix + n.toFixed(2) : "—");
const formatKey = (k: string) => k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// ── workflow ──────────────────────────────────────────────────────────────────
const toast = useToastStore();
const note  = ref("");
// Ground-truth outcome, required when closing a case — this is what the accuracy metrics measure.
const disposition = ref<AnomalyDisposition | "">("");
const DISPOSITION_OPTIONS = ANOMALY_DISPOSITIONS.map((d) => ({ value: d, label: DISPOSITION_LABELS[d] }));

const STATUS_LABELS: Record<string, string> = {
  investigating: "Marked as investigating",
  resolved:      "Anomaly resolved",
  dismissed:     "Anomaly dismissed",
};

async function doTransition(status: "investigating" | "resolved" | "dismissed") {
  // Closing a case must record whether the flag was right — no silent, unlabeled closes.
  if ((status === "resolved" || status === "dismissed") && !disposition.value) {
    toast.error("Pick an outcome", "Select whether this was a confirmed issue, a false alarm, legitimate, or inconclusive.");
    return;
  }
  try {
    await transition.mutateAsync({
      id: props.anomaly.id,
      status,
      note: note.value || undefined,
      disposition: disposition.value || undefined,
      version: props.anomaly.version,
    });
    note.value = "";
    disposition.value = "";
    toast.success(STATUS_LABELS[status] ?? "Status updated");
    emit("changed");
  } catch (e) {
    toast.error("Update failed", e instanceof Error ? e.message : undefined);
  }
}

async function doFalseAlarm() {
  try {
    await transition.mutateAsync({ id: props.anomaly.id, status: "dismissed", note: "False alarm", disposition: "false_positive", version: props.anomaly.version });
    toast.success("Marked as false alarm");
    emit("changed");
  } catch (e) {
    toast.error("Could not update", e instanceof Error ? e.message : undefined);
  }
}

async function reexamine() {
  try {
    const result = await aiExamine.mutateAsync(props.anomaly.id);
    if (result.cleared) {
      toast.success("Anomaly auto-cleared", result.message ?? undefined);
      emit("changed");
    } else if (result.assessment) {
      toast.success("AI assessment ready");
    } else {
      toast.info("AI produced no assessment", result.message ?? undefined);
    }
  } catch (e) {
    toast.error("AI verification failed", e instanceof Error ? e.message : undefined);
  }
}
  return {
    txn, assessment, aiLoading, aiExamine, transition,
    caseSignals, isCase, caseScore, caseLevel, caseAxes, evidenceRows,
    hasCardSignal, cardRef, windowHours, siblingFills, siblingLoading,
    driverName, unitNumber, vehicleDesc,
    tab, orgTz, odometerOffset,
    axisClass, weightBarClass,
    fmt, fmtShort, fmtOdo, fmtMoney, formatKey,
    note, disposition, DISPOSITION_OPTIONS,
    doTransition, doFalseAlarm, reexamine,
  };
}
