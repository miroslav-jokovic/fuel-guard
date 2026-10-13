<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { AppButton as BaseButton, AppInput } from "@silvicom/ui";
import {
  FUEL_EXCEPTION_KIND_LABELS, FUEL_EXCEPTION_STATUS_LABELS,
  type FuelExceptionStatus,
} from "@silvicom/shared";
import SlideOver from "@/components/SlideOver.vue";
import QueryState from "@/components/ui/QueryState.vue";
import FactList, { type Fact } from "@/components/ui/FactList.vue";
import { BADGE_BASE, toneClass, fuelExceptionStatusBadge } from "@/lib/badges";
import { useToastStore } from "@/stores/toast";
import { useSessionStore } from "@/stores/session";
import { useExceptionQuery, useMoveException } from "./useExceptions";
import { usd } from "./format";
import { formatDate } from "@/lib/format";

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
const session = useSessionStore();
/** The PATCH route is `fuel: manage`; a viewer is shown the record and no buttons that would 403. */
const canAct = computed(() => session.can("fuel"));
const id = computed(() => props.id);
const { data, isLoading, isError, error, isFetching, refetch } = useExceptionQuery(id);
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

/**
 * ── ONE BUTTON PER MOVE (F02-F04 8c4 follow-up, ruled 2026-10-08: clicks count from the row) ──────
 * The footer was a status menu and a Save button: row, menu, status, Save — four clicks to close a
 * finding, against the plan's three. Every move is now its own button and acts at once, so a close is
 * two clicks; a credit asks for the amount first (row, Credited, Save credit), because what came back
 * is a different number from what was claimed (E3) and it must be typed, never defaulted.
 */
const moves = computed(() => MOVES.filter((m) => m.value !== ex.value?.status));
const crediting = ref(false);
watch(id, () => { crediting.value = false; });

async function apply(status: FuelExceptionStatus | undefined) {
  const e = ex.value;
  if (!e) return;
  if (!status && note.value.trim() === "") return;
  try {
    await move.mutateAsync({
      id: e.id,
      status,
      note: note.value.trim() || undefined,
      creditedAmount: status === "credited" ? Number(creditedAmount.value) : undefined,
    });
    note.value = "";
    creditedAmount.value = "";
    crediting.value = false;
    toast.success(status ? `Marked ${FUEL_EXCEPTION_STATUS_LABELS[status].toLowerCase()}` : "Note added");
  } catch (err) {
    toast.error("Could not update that finding", err instanceof Error ? err.message : undefined);
  }
}
const creditReady = computed(() => creditedAmount.value !== "" && Number(creditedAmount.value) >= 0);

const money = (v: number | string | null | undefined) => (v == null ? "—" : usd(Number(v)));
/** The finding's own facts (D-US6). A site with no number, city or state is a blank, so FactList draws its dash. */
const findingFacts = computed<Fact[]>(() => {
  const e = ex.value;
  if (!e) return [];
  const facts: Fact[] = [
    { label: "Site", value: [e.site_number, e.city, e.state].filter(Boolean).join(" ") || null },
    { label: "First seen", value: formatDate(e.first_seen_at) },
  ];
  if (e.credited_amount != null) {
    facts.push({ label: "Credited", value: `${money(e.credited_amount)} on ${formatDate(e.credited_on)}`, tone: "text-success-700" });
  }
  return facts;
});
/** The evidence blob, as label/value pairs — it differs per kind and the template must not assume. */
const evidenceRows = computed<Fact[]>(() =>
  Object.entries(ex.value?.evidence ?? {})
    .filter(([, v]) => v != null && v !== "")
    .map(([k, v]) => ({ key: k, label: k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()), value: String(v) })),
);
</script>

<template>
  <SlideOver :open="id != null" :title="ex ? FUEL_EXCEPTION_KIND_LABELS[ex.kind] : 'Finding'" size="lg" @close="emit('close')">
    <!-- A finding that failed to load used to leave the drawer blank under its title; it now says so
         and offers a Retry (D-US5). Compact: this is a drawer, and the block form would crowd it. -->
    <QueryState
      compact
      :loading="isLoading && !ex"
      :error="isError && !ex ? (error ?? true) : null"
      :retrying="isFetching"
      loading-text="Loading the finding…"
      error-text="Could not load this finding."
      @retry="refetch()"
    >
    <div v-if="ex" class="space-y-6">
      <div class="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p class="text-2xl font-bold" :class="ex.amount_kind === 'unrecorded' ? 'text-danger-700' : 'text-ink'">
            {{ money(ex.amount) }}
          </p>
          <p class="text-xs text-ink-muted">{{ ex.occurred_on ? formatDate(ex.occurred_on) : "no date" }} · unit {{ ex.unit_number ?? "—" }}</p>
        </div>
        <span :class="[BADGE_BASE, toneClass(fuelExceptionStatusBadge(ex.status).tone)]">
          {{ fuelExceptionStatusBadge(ex.status).label }}
        </span>
      </div>

      <FactList :facts="findingFacts" :columns="2" class="border-t border-edge-subtle pt-4" data-testid="finding-facts" />

      <!-- The evidence, so nobody has to open the statement PDF to decide whether this is worth
           chasing. Rendered from the blob rather than a fixed list: it differs per kind. -->
      <div v-if="evidenceRows.length">
        <h4 class="text-sm font-semibold text-ink">What the report and our records say</h4>
        <!-- Monospaced, as before: these are the identifiers a person reads back to the vendor, digit by digit. -->
        <FactList :facts="evidenceRows" layout="rows" class="mt-2" data-testid="finding-evidence">
          <template v-for="r in evidenceRows" :key="r.key" #[`value-${r.key}`]="{ fact }">
            <span class="font-mono text-xs">{{ fact.value }}</span>
          </template>
        </FactList>
      </div>

      <div v-if="events.length">
        <h4 class="text-sm font-semibold text-ink">What happened to it</h4>
        <ul class="mt-2 space-y-2">
          <li v-for="e in events" :key="e.id" class="border-l-2 border-edge pl-3">
            <p class="text-xs text-ink-secondary">
              {{ e.to_status ? FUEL_EXCEPTION_STATUS_LABELS[e.to_status as FuelExceptionStatus] ?? e.to_status : e.kind }}
              <span class="text-ink-tertiary">· {{ formatDate(e.created_at) }}</span>
            </p>
            <p v-if="e.note" class="text-xs text-ink-muted">{{ e.note }}</p>
          </li>
        </ul>
      </div>
    </div>
    </QueryState>

    <template #footer>
      <div v-if="ex && canAct" class="flex w-full flex-col gap-3">
        <AppInput v-model="note" type="text" placeholder="Add a note (optional)" class="w-full" />
        <!-- The credited amount is asked for ONLY when the move is a credit: what came back is a
             different number from what was claimed, and E3's whole point is not to conflate them. -->
        <div v-if="crediting" class="flex flex-wrap items-center gap-3">
          <AppInput v-model="creditedAmount" type="number" step="0.01" placeholder="Amount credited" class="w-40" />
          <BaseButton variant="primary" :disabled="!creditReady || move.isPending.value" @click="apply('credited')">
            Save credit
          </BaseButton>
          <BaseButton variant="ghost" @click="crediting = false">Cancel</BaseButton>
        </div>
        <div v-else class="flex flex-wrap items-center gap-2">
          <BaseButton
            v-for="m in moves"
            :key="m.value"
            size="sm"
            variant="secondary"
            :disabled="move.isPending.value"
            @click="m.value === 'credited' ? (crediting = true) : apply(m.value)"
          >
            {{ m.label }}
          </BaseButton>
          <BaseButton size="sm" variant="ghost" :disabled="!note.trim() || move.isPending.value" @click="apply(undefined)">
            Add note
          </BaseButton>
        </div>
      </div>
    </template>
  </SlideOver>
</template>
