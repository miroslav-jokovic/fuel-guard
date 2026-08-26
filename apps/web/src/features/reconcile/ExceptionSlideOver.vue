<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { AppButton as BaseButton, AppInput } from "@fuelguard/ui";
import {
  FUEL_EXCEPTION_KIND_LABELS, FUEL_EXCEPTION_STATUS_LABELS,
  type FuelExceptionStatus,
} from "@fuelguard/shared";
import SlideOver from "@/components/SlideOver.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import { BADGE_BASE, toneClass, fuelExceptionStatusBadge } from "@/lib/badges";
import { useToastStore } from "@/stores/toast";
import { useExceptionQuery, useMoveException } from "./useExceptions";
import { usd } from "./format";

/**
 * One finding, its evidence, and what somebody did about it.
 *
 * ── THE EVIDENCE IS SHOWN, NOT SUMMARISED ────────────────────────────────────────────────────────
 * A person deciding whether to take a $242 line to Pilot needs the gallons, the authorisation number
 * and the card — the things that identify the fill on the vendor's own system. Making them open the
 * statement PDF to find them is how a finding stops being worth chasing.
 *
 * ── AND A MOVE IS NEVER SILENT ───────────────────────────────────────────────────────────────────
 * Every status change, assignment and note writes an act-log row server-side, and the log is rendered
 * here. That pairing is the whole reason this ledger exists rather than a spreadsheet: "who closed a
 * $9,000 dispute, and when" has an answer.
 */
const props = defineProps<{ id: string | null }>();
const emit = defineEmits<{ close: [] }>();

const toast = useToastStore();
const id = computed(() => props.id);
const { data, isLoading } = useExceptionQuery(id);
const move = useMoveException();

const ex = computed(() => data.value?.exception ?? null);
const events = computed(() => data.value?.events ?? []);

const note = ref("");
const creditedAmount = ref<string>("");
// A fresh finding gets a fresh form; carrying a half-typed note onto the next row is how the wrong
// note lands on the wrong dispute.
watch(id, () => { note.value = ""; creditedAmount.value = ""; });

/**
 * `resolved_by_reingest` is missing on purpose. It is the DETECTOR's answer — "a later reconciliation
 * no longer produced this" — and a person claiming it would erase the difference between that and a
 * decision somebody actually made. The API refuses it too.
 */
const MOVES: { value: FuelExceptionStatus; label: string }[] = (
  ["open", "investigating", "disputed", "credited", "dismissed"] as const
).map((v) => ({ value: v, label: FUEL_EXCEPTION_STATUS_LABELS[v] }));

const nextStatus = ref<FuelExceptionStatus | "">("");
watch(ex, (e) => { nextStatus.value = e?.status ?? ""; });

const dirty = computed(
  () => (nextStatus.value !== "" && nextStatus.value !== ex.value?.status) || note.value.trim() !== "",
);

async function apply() {
  const e = ex.value;
  if (!e || !dirty.value) return;
  const status = nextStatus.value === "" || nextStatus.value === e.status ? undefined : nextStatus.value;
  try {
    await move.mutateAsync({
      id: e.id,
      status,
      note: note.value.trim() || undefined,
      creditedAmount: status === "credited" ? Number(creditedAmount.value) || 0 : undefined,
    });
    note.value = "";
    toast.success(status ? `Marked ${FUEL_EXCEPTION_STATUS_LABELS[status].toLowerCase()}` : "Note added");
  } catch (err) {
    toast.error("Could not update that finding", err instanceof Error ? err.message : undefined);
  }
}

const money = (v: number | string | null | undefined) => (v == null ? "—" : usd(Number(v)));
const site = computed(() =>
  [ex.value?.site_number, ex.value?.city, ex.value?.state].filter(Boolean).join(" ") || "—",
);
/** The evidence blob, as label/value pairs — it differs per kind and the template must not assume. */
const evidenceRows = computed(() =>
  Object.entries(ex.value?.evidence ?? {})
    .filter(([, v]) => v != null && v !== "")
    .map(([k, v]) => ({ label: k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()), value: String(v) })),
);
</script>

<template>
  <SlideOver :open="id != null" :title="ex ? FUEL_EXCEPTION_KIND_LABELS[ex.kind] : 'Finding'" size="lg" @close="emit('close')">
    <p v-if="isLoading && !ex" class="text-sm text-ink-muted">Loading…</p>

    <div v-else-if="ex" class="space-y-6">
      <div class="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p class="text-2xl font-bold" :class="ex.amount_kind === 'unrecorded' ? 'text-danger-700' : 'text-ink'">
            {{ money(ex.amount) }}
          </p>
          <p class="text-xs text-ink-muted">{{ ex.occurred_on ?? "no date" }} · unit {{ ex.unit_number ?? "—" }}</p>
        </div>
        <span :class="[BADGE_BASE, toneClass(fuelExceptionStatusBadge(ex.status).tone)]">
          {{ fuelExceptionStatusBadge(ex.status).label }}
        </span>
      </div>

      <dl class="grid grid-cols-2 gap-4 border-t border-edge-subtle pt-4">
        <div><dt class="text-xs text-ink-muted">Site</dt><dd class="text-sm text-ink">{{ site }}</dd></div>
        <div><dt class="text-xs text-ink-muted">First seen</dt><dd class="text-sm text-ink">{{ ex.first_seen_at.slice(0, 10) }}</dd></div>
        <div v-if="ex.credited_amount != null">
          <dt class="text-xs text-ink-muted">Credited</dt>
          <dd class="text-sm font-medium text-success-700">{{ money(ex.credited_amount) }} on {{ ex.credited_on ?? "—" }}</dd>
        </div>
      </dl>

      <!-- The evidence, so nobody has to open the statement PDF to decide whether this is worth
           chasing. Rendered from the blob rather than a fixed list: it differs per kind. -->
      <div v-if="evidenceRows.length">
        <h4 class="text-sm font-semibold text-ink">What the report and our records say</h4>
        <dl class="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
          <template v-for="r in evidenceRows" :key="r.label">
            <dt class="text-xs text-ink-muted">{{ r.label }}</dt>
            <dd class="text-xs font-mono text-ink-secondary">{{ r.value }}</dd>
          </template>
        </dl>
      </div>

      <div v-if="events.length">
        <h4 class="text-sm font-semibold text-ink">What happened to it</h4>
        <ul class="mt-2 space-y-2">
          <li v-for="e in events" :key="e.id" class="border-l-2 border-edge pl-3">
            <p class="text-xs text-ink-secondary">
              {{ e.to_status ? FUEL_EXCEPTION_STATUS_LABELS[e.to_status as FuelExceptionStatus] ?? e.to_status : e.kind }}
              <span class="text-ink-tertiary">· {{ e.created_at.slice(0, 10) }}</span>
            </p>
            <p v-if="e.note" class="text-xs text-ink-muted">{{ e.note }}</p>
          </li>
        </ul>
      </div>
    </div>

    <template #footer>
      <div v-if="ex" class="flex w-full flex-wrap items-end gap-3">
        <FilterSelect v-model="nextStatus" label="Status" :options="MOVES" />
        <!-- The credited amount is asked for ONLY when the move is a credit: what came back is a
             different number from what was claimed, and E3's whole point is not to conflate them. -->
        <AppInput
          v-if="nextStatus === 'credited'"
          v-model="creditedAmount"
          type="number"
          step="0.01"
          placeholder="Amount credited"
          class="w-40"
        />
        <AppInput v-model="note" type="text" placeholder="Add a note" class="min-w-48 flex-1" />
        <BaseButton variant="primary" :disabled="!dirty || move.isPending.value" @click="apply">
          {{ move.isPending.value ? "Saving…" : "Save" }}
        </BaseButton>
      </div>
    </template>
  </SlideOver>
</template>
