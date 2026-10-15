<script setup lang="ts">
import { formatRuleId, DISPOSITION_LABELS, type Anomaly, CORRELATION_THRESHOLDS } from "@silvicom/shared";
import AnomalyAudit from "./AnomalyAudit.vue";
import StatusBadge from "@/components/StatusBadge.vue";
import { AppButton as BaseButton, AppTabs, type TabItem } from "@silvicom/ui";
import { AppTextarea } from "@silvicom/ui";
import { BADGE_BASE, severityTone } from "@/lib/badges";
import EntityHistory from "./EntityHistory.vue";
import { useAnomalyDetail } from "./useAnomalyDetail";
import { computed } from "vue";
import { DataTable } from "@silvicom/ui";
import { FactList, type Fact } from "@silvicom/ui";
import { QueryState } from "@silvicom/ui";
import { type DataTableColumn } from "@silvicom/ui";

const DETAIL_TABS: TabItem[] = [
  { value: "overview", label: "Overview" },
  { value: "audit", label: "Odometer & Location" },
];

const props = defineProps<{ anomaly: Anomaly; vehicleUnit: string }>();
const emit = defineEmits<{ changed: [] }>();

const {
  txn, txnLoading, txnError, txnFetching, refetchTxn, transition,
  caseSignals, isCase, caseScore, caseLevel, caseAxes, evidenceRows,
  hasCardSignal, cardRef, windowHours, siblingFills, siblingLoading,
  siblingError, siblingFetching, refetchSiblings,
  driverName, unitNumber, vehicleDesc,
  tab, orgTz, odometerOffset,
  axisClass, weightBarClass,
  fmt, fmtShort, fmtOdo, fmtMoney, formatKey,
  note, disposition, DISPOSITION_OPTIONS,
  doTransition, doFalseAlarm,
} = useAnomalyDetail(props, emit);

// D-US4: the same-card fills are a DataTable; a blank price, odometer or place shows its em dash.
const siblingColumns: DataTableColumn[] = [
  { key: "vehicle", label: "Vehicle" },
  { key: "when", label: "When" },
  { key: "gallons", label: "Gallons", numeric: true, cellClass: "font-medium text-ink" },
  { key: "price", label: "$/gal", numeric: true },
  { key: "odo", label: "Odometer", numeric: true },
  { key: "driver", label: "Driver" },
  { key: "place", label: "Location", cellClass: "text-ink-muted" },
];
const siblingRows = computed(() =>
  (siblingFills.value ?? []).map((f) => ({
    ...f,
    when: fmtShort(f.fueled_at, f.state),
    price: f.price_per_gal != null ? fmtMoney(f.price_per_gal) : null,
    odo: f.odometer != null ? fmtOdo(f.odometer) : null,
    driver: driverName(f.driver_id),
    place: [f.city, f.state].filter(Boolean).join(", ") || f.location_text || null,
  })),
);
const thisFillClass = (row: { id: string }) =>
  row.id === txn.value?.id ? "bg-warning-100 ring-1 ring-inset ring-warning-300" : "";

// D-US6: the facts are FactLists, so a blank import id, odometer or MPG shows the shared em dash.
// Ids keep their monospace through `tone`, which replaces the value's `text-ink`.
const MONO = "font-mono text-xs text-ink";
const headerFacts = computed<Fact[]>(() => {
  const t = txn.value;
  if (!t) return [];
  return [
    { label: "Source", value: t.source },
    { label: "Imported", value: t.import_id ? "EFS/report batch" : "Direct entry" },
    { label: "Fuel transaction", value: t.id, tone: MONO },
    { label: "Import id", value: t.import_id, tone: MONO },
  ];
});
const evidenceValue = (v: unknown): string | number | null =>
  v == null ? null : Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : typeof v === "number" ? v : String(v);
const evidenceFacts = computed<Fact[]>(() =>
  evidenceRows.value.map(([k, v]) => ({ key: k, label: formatKey(k), value: evidenceValue(v) })),
);
const transactionFacts = computed<Fact[]>(() => {
  const t = txn.value;
  if (!t) return [];
  const facts: Array<Fact | false> = [
    { key: "vehicle", label: "Vehicle", value: props.vehicleUnit },
    // driverName answers "—" for an unattributed fill; a null driver is the FactList's blank instead.
    { label: "Driver", value: t.driver_id ? driverName(t.driver_id) : null },
    !!t.card_ref && { label: "Card #", value: t.card_ref, tone: "font-mono text-ink" },
    { label: "When", value: fmt(t.fueled_at, t.state) },
    { label: "Odometer", value: t.odometer != null ? fmtOdo(t.odometer) : null, numeric: true },
    { label: "Gallons", value: t.gallons, numeric: true },
    t.price_per_gal != null && { label: "$/gal", value: fmtMoney(t.price_per_gal), numeric: true },
    t.total_cost != null && { label: "Total cost", value: fmtMoney(t.total_cost), numeric: true },
    { label: "MPG", value: t.computed_mpg, numeric: true },
    { label: "Location", value: t.location_text || [t.city, t.state].filter(Boolean).join(", ") || null },
    t.samsara_location_matched != null && { key: "samsara", label: "Samsara location" },
    { label: "Source", value: t.source, tone: "capitalize text-ink" },
  ];
  return facts.filter((f): f is Fact => f !== false);
});
</script>

<template>
  <div class="space-y-5">

    <!-- ① Header badges + rule label -->
    <div class="flex flex-wrap items-center gap-2">
      <span :class="[BADGE_BASE, severityTone(anomaly.severity), 'capitalize']">{{ anomaly.severity }}</span>
      <StatusBadge :status="anomaly.status" />
      <span class="text-xs text-ink-muted" :title="anomaly.rule_id">{{ formatRuleId(anomaly.rule_id) }}</span>
    </div>

    <p class="text-sm leading-relaxed text-ink">{{ anomaly.message }}</p>

    <FactList v-if="txn" :columns="2" class="rounded-surface bg-surface-subtle p-4 ring-1 ring-edge" :facts="headerFacts" />

    <!-- Entity-intelligence panel (Phases 1–2): reviewer context + retrospective pattern report -->
    <EntityHistory :anomaly-id="anomaly.id" />

    <!-- ② Case score banner (theft_case only) -->
    <!-- ui-adoption: not-a-notice — the case score meter (bar, threshold, axis chips), a measurement on a tint rather than a sentence about the page. -->
    <div
      v-if="isCase && caseScore != null"
      class="flex flex-wrap items-center gap-4 rounded-surface bg-warning-50 px-4 py-3 ring-1 ring-warning-200"
    >
      <div class="flex flex-1 flex-col gap-1 min-w-[10rem]">
        <div class="flex items-center justify-between text-xs">
          <span class="font-semibold text-ink-secondary">Correlation score</span>
          <span class="font-bold text-ink">{{ caseScore }}<span class="font-normal text-ink-tertiary"> / 200</span></span>
        </div>
        <div class="h-2 w-full overflow-hidden rounded-full bg-neutral-200">
          <div
            class="h-2 rounded-full transition-all"
            :class="caseLevel === 'alert' ? 'bg-danger-500' : 'bg-warning-400'"
            :style="{ width: `${Math.min(100, (caseScore / 200) * 100)}%` }"
          />
        </div>
        <p class="text-2xs leading-4 text-ink-tertiary">
          Alert: one signal ≥ {{ CORRELATION_THRESHOLDS.overwhelming }}, or ≥2 independent axes scoring
          ≥ {{ CORRELATION_THRESHOLDS.alertScore }} combined · Review: one signal ≥ {{ CORRELATION_THRESHOLDS.review }}
        </p>
      </div>
      <div class="flex flex-wrap gap-1">
        <span
          v-for="ax in caseAxes"
          :key="ax"
          :class="['inline-flex rounded-control px-1.5 py-0.5 text-xs font-semibold uppercase', axisClass(ax)]"
        >{{ ax }}</span>
      </div>
    </div>

    <AppTabs v-model="tab" :tabs="DETAIL_TABS" label="Anomaly detail views" id-prefix="anomaly-detail" />

    <!-- AUDIT TAB -->
    <div
      v-if="tab === 'audit'"
      id="anomaly-detail-panel-audit"
      role="tabpanel"
      aria-labelledby="anomaly-detail-tab-audit"
    >
      <QueryState
        compact
        :loading="txnLoading"
        :error="txnError"
        :retrying="txnFetching"
        loading-text="Loading the transaction…"
        error-text="Could not load the transaction."
        @retry="refetchTxn()"
      >
        <AnomalyAudit v-if="txn" :txn="txn" :odometer-offset="odometerOffset" :tz="orgTz" />
        <p v-else class="text-sm text-ink-tertiary italic">No fuel transaction is linked to this anomaly.</p>
      </QueryState>
    </div>

    <!-- OVERVIEW TAB -->
    <div
      v-if="tab === 'overview'"
      id="anomaly-detail-panel-overview"
      role="tabpanel"
      aria-labelledby="anomaly-detail-tab-overview"
      class="space-y-5"
    >
      <!-- ③ Contributing signals / Why this fired -->
      <div class="rounded-surface bg-surface-subtle p-4 ring-1 ring-edge">
      <h4 class="text-xs font-semibold uppercase tracking-wide text-ink-muted">
        {{ isCase ? "Contributing signals" : "Why this fired" }}
      </h4>

      <!-- Case: signal list with axis + weight bars -->
      <ul v-if="isCase" class="mt-3 space-y-4">
        <li v-for="s in caseSignals" :key="s.ruleId" class="flex gap-3">
          <div class="flex shrink-0 flex-col items-start gap-1 pt-0.5">
            <span :class="['inline-flex rounded-control px-1.5 py-0.5 text-xs font-semibold uppercase', axisClass(s.axis)]">
              {{ s.axis }}
            </span>
            <span :class="[BADGE_BASE, severityTone(s.severity), 'capitalize']">{{ s.severity }}</span>
          </div>
          <div class="min-w-0 flex-1">
            <div class="mb-1 flex items-center gap-2">
              <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-200">
                <div
                  class="h-1.5 rounded-full"
                  :class="weightBarClass(s.weight)"
                  :style="{ width: `${s.weight}%` }"
                />
              </div>
              <span class="shrink-0 text-xs text-ink-tertiary">{{ s.weight }}/100</span>
            </div>
            <p class="text-sm text-ink-secondary">{{ s.message }}</p>
            <p v-if="s.ruleId === 'card_multi_vehicle'" class="mt-0.5 text-xs font-medium text-brand-600">
              ↓ Sibling fills shown below
            </p>
          </div>
        </li>
      </ul>

      <!-- Single rule: formatted evidence key/value -->
      <FactList v-else layout="rows" class="mt-2" :facts="evidenceFacts" />
      </div>

    <!-- ④ Same-card fills — appears whenever card_multi_vehicle is in play -->
      <div v-if="hasCardSignal" class="rounded-surface border border-warning-200 bg-warning-50/50 p-4">
      <div class="mb-3 flex flex-wrap items-baseline gap-2">
        <h4 class="text-xs font-semibold uppercase tracking-wide text-ink-secondary">Same-card fills</h4>
        <span v-if="cardRef" class="font-mono text-xs text-ink-muted">card {{ cardRef }}</span>
        <span class="text-xs text-ink-tertiary">· ±{{ windowHours }}h window</span>
      </div>

      <!-- Two reads in a row: the transaction gives the card, the card gives its sibling fills. Each
           has its own Retry, so a failed sibling scan does not send the reviewer back to reload the
           whole drawer (D-US5). -->
      <QueryState
        compact
        :loading="txnLoading"
        :error="txnError"
        :retrying="txnFetching"
        loading-text="Loading the transaction…"
        error-text="Could not load the transaction."
        @retry="refetchTxn()"
      >
      <p v-if="!cardRef" class="text-sm text-ink-tertiary italic">No card reference on this transaction.</p>
      <QueryState
        v-else
        compact
        :loading="siblingLoading"
        :error="siblingError"
        :retrying="siblingFetching"
        loading-text="Loading related fills…"
        error-text="Could not load the related fills."
        @retry="refetchSiblings()"
      >
      <DataTable
        embedded
        dense
        :sticky-header="false"
        :columns="siblingColumns"
        :rows="siblingRows"
        row-key="id"
        empty-text="No other fills on this card in this window."
        :row-class="thisFillClass"
      >
        <template #cell-vehicle="{ row }">
          <div class="font-medium text-ink">{{ unitNumber(row.vehicle_id) }}</div>
          <div class="text-ink-tertiary">{{ vehicleDesc(row.vehicle_id) }}</div>
          <span v-if="row.id === txn?.id" class="mt-0.5 inline-flex rounded-control bg-warning-200 px-1 py-0.5 text-xs font-medium text-warning-800">
            this fill
          </span>
        </template>
      </DataTable>
      </QueryState>
      </QueryState>
      </div>

    <!-- ⑤ Transaction details (full) -->
      <div v-if="txn" class="rounded-surface border border-edge p-4">
      <h4 class="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">Transaction</h4>
      <!-- Vehicle: the unit, with its year/make/model beside it. Samsara location: the check's verdict. -->
      <FactList layout="rows" :facts="transactionFacts">
        <template #value-vehicle>
          <span class="font-semibold text-ink">{{ vehicleUnit }}</span>
          <span v-if="vehicleDesc(txn.vehicle_id)" class="ml-1 text-xs text-ink-tertiary">
            {{ vehicleDesc(txn.vehicle_id) }}
          </span>
        </template>
        <template #value-samsara>
          <span v-if="txn.samsara_location_matched" class="text-xs font-medium text-success-700">✓ Confirmed</span>
          <span v-else class="text-xs font-semibold text-danger-700">✗ Mismatch</span>
        </template>
      </FactList>
      </div>

    </div>

    <!-- ⑦ Workflow -->
    <div v-if="anomaly.status === 'open' || anomaly.status === 'investigating'" class="space-y-4 border-t border-edge pt-5">
      <div>
        <p class="mb-1.5 text-xs font-medium text-ink-muted">Quick action</p>
        <BaseButton
          :disabled="transition.isPending.value"
          class="rounded-control bg-warning-50 px-3 py-2 text-sm font-medium text-warning-800 ring-1 ring-warning-200 hover:bg-warning-100 disabled:opacity-50"
          title="Checked and confirmed not real — dismiss without re-raising"
          @click="doFalseAlarm"
        >
          Mark as false alarm
        </BaseButton>
      </div>
      <div class="space-y-3">
        <p class="text-xs font-medium text-ink-muted">Advance status</p>
        <div>
          <p class="mb-1.5 text-xs text-ink-muted">Outcome <span class="text-ink-tertiary">(required to resolve or dismiss — this is what measures our accuracy)</span></p>
          <div class="flex flex-wrap gap-2">
            <BaseButton
              v-for="opt in DISPOSITION_OPTIONS"
              :key="opt.value"
              type="button"
              class="rounded-full px-3 py-1 text-sm ring-1 ring-inset transition-colors"
              :class="disposition === opt.value ? 'bg-action-primary text-action-primary-foreground ring-action-primary' : 'bg-surface text-ink-secondary ring-edge-control hover:bg-surface-subtle'"
              @click="disposition = opt.value"
            >
              {{ opt.label }}
            </BaseButton>
          </div>
        </div>
        <AppTextarea
          v-model="note"
          rows="2"
          placeholder="Resolution note (required for resolve / dismiss; optional when investigating)"
        />
        <div class="flex flex-wrap gap-2">
          <BaseButton
            v-if="anomaly.status === 'open'"
            :disabled="transition.isPending.value"
            class="rounded-control bg-warning-100 px-3 py-2 text-sm font-medium text-warning-800 hover:bg-warning-200 disabled:opacity-50"
            @click="doTransition('investigating')"
          >
            Start investigating
          </BaseButton>
          <BaseButton
            :disabled="transition.isPending.value"
            class="rounded-control bg-success-600 px-3 py-2 text-sm font-semibold text-ink-inverse hover:bg-success-500 disabled:opacity-50"
            @click="doTransition('resolved')"
          >
            Resolve
          </BaseButton>
          <BaseButton :disabled="transition.isPending.value" @click="doTransition('dismissed')">
            Dismiss
          </BaseButton>
        </div>
      </div>
    </div>
    <div v-else class="border-t border-edge pt-4 text-sm text-ink-muted">
      <div class="mb-3 flex items-center justify-between gap-3">
        <p>Closed case — the original disposition is historical.</p>
        <BaseButton size="sm" :disabled="transition.isPending.value" @click="doTransition('investigating')">Reopen investigation</BaseButton>
      </div>
      <p v-if="anomaly.status === 'resolved'">
        Resolved<span v-if="anomaly.resolution_note"> — {{ anomaly.resolution_note }}</span>
      </p>
      <p v-else-if="anomaly.resolution_note === 'False alarm'">Marked as false alarm</p>
      <p v-else>
        Dismissed<span v-if="anomaly.resolution_note"> — {{ anomaly.resolution_note }}</span>
      </p>
      <p v-if="anomaly.disposition" class="mt-1 text-xs">
        Outcome: <span class="font-medium text-ink-secondary">{{ DISPOSITION_LABELS[anomaly.disposition] }}</span>
      </p>
    </div>

  </div>
</template>
