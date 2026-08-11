<script setup lang="ts">
import { computed, ref } from "vue";
import { useQueryClient } from "@tanstack/vue-query";
import { AppIcon } from "@fuelguard/ui";
import { ChevronRightIcon, ShieldExclamationIcon } from "@fuelguard/ui/icons";
import {
  HAZMAT_LOAD_STATUS_LABELS,
  type HazmatCreateLoadRequest,
  type HazmatLoadStatus,
} from "@fuelguard/shared";
import { AppCard as BaseCard } from "@fuelguard/ui";
import { AppButton as BaseButton } from "@fuelguard/ui";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { apiFetch } from "@/lib/api";
import { useToastStore } from "@/stores/toast";
import { isAnalyzing } from "@/features/hazmat/useHazmatLoads";

interface HazmatPanelRecord {
  id: string;
  status: string;
  tank_state: string;
  updated_at: string;
  latest_outcome: string | null;
  latest_run_at: string | null;
}
interface HazmatPanelLoad {
  id: string;
  vehicle_id: string | null;
  trailer_id: string | null;
  driver_id: string | null;
  stops: Array<{ kind: string; appointment_start: string | null }>;
  hazmat_record: HazmatPanelRecord | null;
}

/**
 * The hazmat section of the DISPATCH load page (H-C1's UI half — the workspace opens from the load,
 * not from a parallel board). Composition mirrors the page's other cards: BaseCard, the h2/`text-sm
 * font-semibold` header, BADGE_BASE chips, `dl` meta grids — nothing bespoke.
 *
 * The one new pattern is the STATUS RAIL: the record's fixed pipeline (declare → submit → analyze →
 * clear) drawn as dots-and-connectors, the way freight tracking UIs (shipment milestone rails) show
 * a load's position at a glance. It renders from the same locked state machine the API enforces
 * (`hazmatLifecycle`), tones only from the token palette, and degrades to a plain terminal chip for
 * rejected/cancelled/superseded — a rail implies forward motion those states do not have.
 */
const props = defineProps<{ load: HazmatPanelLoad; canManage: boolean }>();

const toast = useToastStore();
const qc = useQueryClient();
const record = computed<HazmatPanelRecord | null>(() => props.load.hazmat_record);

// ── the status rail ──────────────────────────────────────────────────────────
interface RailStage {
  key: string;
  label: string;
  state: "done" | "current" | "upcoming";
  /** The analyzing stage pulses while a run is actually executing. */
  live?: boolean;
}
const TERMINAL_BAD: Record<string, string> = { rejected: "danger", cancelled: "neutral", superseded: "neutral" };
const RAIL: Array<{ key: string; label: string; reached: (s: HazmatLoadStatus) => boolean }> = [
  { key: "declared", label: "Declared", reached: () => true },
  { key: "submitted", label: "Submitted", reached: (s) => s !== "draft" },
  { key: "analyzed", label: "Analyzed", reached: (s) => s === "needs_review" || s === "cleared" },
  { key: "cleared", label: "Cleared", reached: (s) => s === "cleared" },
];
const rail = computed<RailStage[]>(() => {
  const s = (record.value?.status ?? "draft") as HazmatLoadStatus;
  if (TERMINAL_BAD[s]) return [];
  const reachedFlags = RAIL.map((st) => st.reached(s));
  const currentIdx = reachedFlags.lastIndexOf(true);
  return RAIL.map((st, i) => ({
    key: st.key,
    label: i === 2 && isAnalyzing(s) ? "Analyzing…" : st.label,
    state: i < currentIdx ? "done" : i === currentIdx ? "current" : "upcoming",
    live: i === 2 && s === "extracting",
  }));
});
const terminalTone = computed(() => TERMINAL_BAD[record.value?.status ?? ""] ?? null);
const statusLabel = computed(() =>
  record.value ? (HAZMAT_LOAD_STATUS_LABELS[record.value.status as HazmatLoadStatus] ?? record.value.status) : null,
);
const statusTone = computed(() => {
  const s = record.value?.status;
  if (s === "cleared") return "success";
  if (s === "needs_review") return "warning";
  if (s === "rejected") return "danger";
  if (s === "draft" || s === "cancelled" || s === "superseded") return "neutral";
  return "brand"; // submitted / extracting — in motion
});

function when(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ── actions ──────────────────────────────────────────────────────────────────
const busy = ref(false);
async function call<T>(path: string, method: string, body?: unknown): Promise<T> {
  const res = await apiFetch<T>(path, { method, ...(body === undefined ? {} : { body }) });
  if (!res.ok) throw new Error(res.error?.message ?? "That did not work");
  return res.data as T;
}
async function refresh() {
  await Promise.all([
    qc.invalidateQueries({ queryKey: ["dispatch", "load"] }),
    qc.invalidateQueries({ queryKey: ["dispatch", "loads"] }),
    qc.invalidateQueries({ queryKey: ["hazmat", "loads"] }),
  ]);
}

/** Start the hazmat record FROM the dispatch load: create (equipment/driver/pickup prefilled from
 *  what dispatch already knows) and link in one step, then hand off to the workspace for products. */
async function startRecord() {
  if (!props.canManage || busy.value) return;
  busy.value = true;
  try {
    const id = crypto.randomUUID();
    const firstPickup = props.load.stops.find((s) => s.kind === "pickup");
    const body: HazmatCreateLoadRequest = {
      id,
      vehicleId: props.load.vehicle_id ?? null,
      trailerId: props.load.trailer_id ?? null,
      driverId: props.load.driver_id ?? null,
      tankState: "loaded",
      carrierRelationship: "unknown",
      plannedPickupAt: firstPickup?.appointment_start ?? null,
      declaredLines: [],
      specialPermitNumbers: [],
      claimedNoPlacards: false,
      supersedesLoadId: null,
    };
    await call<{ id: string }>("/api/hazmat/loads", "POST", body);
    await call<{ ok: boolean }>(`/api/hazmat/loads/${id}/link`, "POST", { loadId: props.load.id });
    await refresh();
    toast.success("Hazmat record started", "Declare the products in the workspace, then submit for analysis.");
  } catch (e) {
    toast.error("Could not start the hazmat record", e instanceof Error ? e.message : undefined);
  } finally {
    busy.value = false;
  }
}

async function submitAndAnalyze() {
  const r = record.value;
  if (!r || !props.canManage || busy.value) return;
  busy.value = true;
  try {
    if (r.status === "draft") await call(`/api/hazmat/loads/${r.id}/submit`, "POST");
    await call<{ runId: string }>(`/api/hazmat/loads/${r.id}/analyze`, "POST");
    await refresh();
    toast.success("Analysis started", "The verdict lands here and in the workspace in a moment.");
  } catch (e) {
    toast.error("Could not analyze", e instanceof Error ? e.message : undefined);
  } finally {
    busy.value = false;
  }
}

const workspaceTo = computed(() => (record.value ? `/hazmat/loads/${record.value.id}` : null));
const packetHref = computed(() =>
  record.value && record.value.latest_run_at ? `/api/hazmat/loads/${record.value.id}/packet` : null,
);
const outcomeTone = computed(() => (record.value?.latest_outcome === "green" ? "success" : "warning"));
</script>

<template>
  <BaseCard>
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="flex items-start gap-3">
        <span class="flex size-9 shrink-0 items-center justify-center rounded-surface bg-warning-50 text-warning-700">
          <AppIcon :icon="ShieldExclamationIcon" class="size-5" aria-hidden="true" />
        </span>
        <div>
          <h2 class="text-sm font-semibold text-ink">Hazmat</h2>
          <p class="mt-0.5 text-xs text-ink-muted">
            {{ record ? "Placarding, eligibility and clearance for this load — enforced before dispatch." : "This load is marked hazmat but its record has not been started." }}
          </p>
        </div>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <span v-if="record" :class="[BADGE_BASE, toneClass(statusTone)]">{{ statusLabel }}</span>
        <BaseButton v-if="workspaceTo" variant="secondary" size="sm" :to="workspaceTo">
          Open workspace
          <AppIcon :icon="ChevronRightIcon" class="size-4" aria-hidden="true" />
        </BaseButton>
      </div>
    </div>

    <!-- No record yet: the entry point IS the load (H-C1). -->
    <div v-if="!record" class="mt-4">
      <p class="rounded-surface bg-warning-50 px-4 py-3 text-sm text-warning-800 ring-1 ring-inset ring-warning-200">
        No placards can be determined and nothing can clear until the hazmat record exists. Starting it
        copies the equipment, driver and pickup time dispatch already entered.
      </p>
      <BaseButton v-if="canManage" class="mt-3" variant="primary" size="sm" :disabled="busy" @click="startRecord">
        {{ busy ? "Starting…" : "Start hazmat record" }}
      </BaseButton>
    </div>

    <template v-else>
      <!-- The status rail — the record's position in its locked pipeline, at a glance. -->
      <ol v-if="rail.length" class="mt-5 flex items-center" aria-label="Hazmat clearance progress">
        <template v-for="(stage, i) in rail" :key="stage.key">
          <li class="flex shrink-0 flex-col items-center gap-1.5">
            <span
              class="flex size-6 items-center justify-center rounded-full text-[11px] font-semibold ring-1 ring-inset"
              :class="
                stage.state === 'done'
                  ? 'bg-selected-strong text-ink ring-selected-strong'
                  : stage.state === 'current'
                    ? 'bg-brand-50 text-brand-700 ring-brand-600'
                    : 'bg-surface text-ink-tertiary ring-edge'
              "
            >
              <span v-if="stage.state === 'done'" aria-hidden="true">✓</span>
              <span v-else-if="stage.live" class="size-2 animate-pulse rounded-full bg-brand-accent-strong" aria-hidden="true" />
              <span v-else aria-hidden="true">{{ i + 1 }}</span>
            </span>
            <span
              class="text-[11px] font-medium"
              :class="stage.state === 'upcoming' ? 'text-ink-tertiary' : 'text-ink-secondary'"
            >
              {{ stage.label }}
            </span>
          </li>
          <li
            v-if="i < rail.length - 1"
            aria-hidden="true"
            class="mx-2 mb-5 h-px min-w-6 flex-1"
            :class="stage.state === 'done' ? 'bg-brand-accent-strong' : 'bg-edge'"
          />
        </template>
      </ol>
      <p v-else class="mt-4">
        <span :class="[BADGE_BASE, toneClass(terminalTone ?? 'neutral')]">{{ statusLabel }}</span>
        <span class="pl-2 text-xs text-ink-muted">See the workspace for the record's history and any superseding record.</span>
      </p>

      <dl class="mt-5 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
        <div>
          <dt class="text-ink-tertiary">Last analysis</dt>
          <dd class="text-ink">
            <span v-if="record.latest_outcome" :class="[BADGE_BASE, toneClass(outcomeTone)]">
              {{ record.latest_outcome === "green" ? "Green" : "Flagged" }}
            </span>
            <span v-else class="text-ink-tertiary">Not analyzed</span>
          </dd>
        </div>
        <div><dt class="text-ink-tertiary">Analyzed at</dt><dd class="text-ink">{{ when(record.latest_run_at) }}</dd></div>
        <div><dt class="text-ink-tertiary">Tank state</dt><dd class="capitalize text-ink">{{ record.tank_state.replace(/_/g, " ") }}</dd></div>
        <div><dt class="text-ink-tertiary">Updated</dt><dd class="text-ink">{{ when(record.updated_at) }}</dd></div>
      </dl>

      <div v-if="canManage" class="mt-4 flex flex-wrap items-center gap-2">
        <BaseButton
          v-if="record.status === 'draft' || record.status === 'submitted'"
          variant="primary"
          size="sm"
          :disabled="busy"
          @click="submitAndAnalyze"
        >
          {{ busy ? "Working…" : record.status === "draft" ? "Submit & analyze" : "Analyze" }}
        </BaseButton>
        <BaseButton v-if="record.status === 'needs_review'" variant="soft" size="sm" to="/hazmat/review">
          Open review queue
        </BaseButton>
        <a
          v-if="packetHref"
          :href="packetHref"
          target="_blank"
          rel="noopener"
          class="text-sm font-medium text-link hover:text-link-hover"
        >
          Roadside packet (PDF)
        </a>
      </div>
      <p v-if="record.status === 'draft'" class="mt-2 text-xs text-ink-muted">
        Declare the products in the workspace before analyzing — an empty declaration cannot clear.
      </p>
    </template>
  </BaseCard>
</template>
