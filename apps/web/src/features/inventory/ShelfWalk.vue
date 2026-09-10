<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  countStockSchema,
  countVarianceTier,
  type PartMovementInput,
  type StockLineDto,
} from "@silvicom/shared";
import { AppButton as BaseButton, AppCallout, AppCard as BaseCard } from "@silvicom/ui";
import PageHeader from "@/components/ui/PageHeader.vue";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import QuantityStepper from "@/components/ui/QuantityStepper.vue";
import { useWakeLock } from "@/composables/useWakeLock";
import {
  useCloseCountSession,
  useCountSessionQuery,
  useRecordMovement,
  useStockQuery,
} from "@/features/inventory/useInventory";
import { useWalk } from "@/features/inventory/useWalk";
import WalkActions, { type WalkAction } from "@/features/inventory/WalkActions.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { useToastStore } from "@/stores/toast";
import { useSessionStore } from "@/stores/session";

/**
 * A shelf walk (INVENTORY-PLAN.md I5 PR 2b; D-INV17 as amended 2026-09-10, D-INV19, D-INV20, D-INV21).
 *
 * ── IT WAS `pages/CountSessionPage.vue` UNTIL I9, AND MOVED WITHOUT CHANGING ──────────────────
 * D-INV19 says one session component serves parts and units, and I9's unit check is the second
 * body: a shelf count types a quantity per bin and a check taps Found or Not here per item, which
 * are two vocabularies and two ledgers. So the ROUTE component is still one — `CountSessionPage.vue`
 * reads the session's kind and hands off — and what the two share moved to `useWalk` and
 * `WalkActions.vue`: the write-then-send order, the queue, the actions rendered where the hand is.
 * Nothing about the walk below changed in the move, and `CountSessionPage.test.ts`'s assertions are
 * what say so.
 *
 * ── IT IS A PAGE IN THE APP'S OWN SHELL, SINCE 2026-09-10 ─────────────────────────────────────
 * D-INV17 gave the count a phone-only shell — no sidebar, a sticky header of its own, a bottom bar.
 * The owner, opening a unit check from the Units list at a desk, found a screen that shared nothing
 * with the page they had come from, and ruled that the walk follows the product's anatomy:
 * `PageHeader` with the location as its title and the progress as its description, the queue's
 * promise as a callout, the current bin as a card, the review as a table. What the phone needed
 * from the old shell survives in `WalkActions.vue`: below `sm` the actions are a fixed bottom bar
 * inside the safe area, and this root pads for it. The scan screen keeps its shell — a scanner in
 * the other hand is a different posture from a shelf to count.
 *
 * ── THE ORDER OF OPERATIONS IS THE DESIGN ─────────────────────────────────────────────────────
 * Type a number → **write it to this phone** → try to send it → move on. Not "send it, and if that
 * works remember it". A bay is where the signal is worst, and the strip at the top of this screen
 * promises the count is safe; that promise is kept by `countQueue`, which writes first and replays
 * on reconnect. Every row carries the movement id minted for it (D-INV27), so a replay is free.
 *
 * ── THE EXPECTED FIGURE IS HIDDEN UNTIL THE COUNT IS TYPED (D-INV20) ──────────────────────────
 * Blind is the default and the mode is recorded on the row, because a variance means one thing if
 * the counter could see "12 expected" and another if they could not. Any `manage` role may reveal,
 * and revealing is recorded on each movement from that point — not on the session, which records
 * only how the walk STARTED.
 *
 * ── D-INV21's LADDER, AND WHAT IT ACTUALLY DOES ON SMALL BINS ─────────────────────────────────
 * `countVarianceTier` is one ladder, not two tests: `confirm` above max(5, 5 %), `recount` above
 * 10 % of the same floor, plus the zero-against-non-zero rule at `confirm`. I1's §8 line records
 * the consequence this screen has to expect: **below about fifty expected there is no numeric
 * `confirm` rung at all**, because both rungs share the floor of 5 and confirm's 5 % is the lower
 * fraction — so on a small bin the only route to a confirm is counting zero against something.
 * That is deliberate; a technician told "are you sure" about a variance of two would stop reading
 * the question by the fourth bin.
 *
 * The confirm carries the CONSEQUENCE and not "Are you sure": "Record 0 of 12" / "Keep counting".
 *
 * ── UNCOUNTED BINS ARE A CHOICE AT CLOSE, NOT A DEFAULT ───────────────────────────────────────
 * A bin nobody walked is not zero. It is uncounted, it says so in the review, and closing leaves it
 * exactly as it was — the alternative writes a shortage the shop never observed.
 */

const route = useRoute();
const router = useRouter();
const toast = useToastStore();
const session = useSessionStore();
const sessionId = computed(() => String(route.params.sessionId ?? ""));

const { data: walk, isLoading: walkLoading, isError: walkFailed } = useCountSessionQuery(sessionId);
const locationId = computed(() => walk.value?.locationId ?? undefined);
const { data: stock, isLoading: stockLoading } = useStockQuery(locationId);
const record = useRecordMovement();
const closeWalk = useCloseCountSession();
const wakeLock = useWakeLock();

/** What has been counted in THIS walk: line key → the total that was typed. */
const counted = ref<Record<string, number>>({});
const flagged = ref<Record<string, true>>({});
const revealed = ref(false);
const reviewing = ref(false);
const draft = ref<number | null>(null);
const index = ref(0);

const lines = computed<StockLineDto[]>(() => stock.value?.lines ?? []);
const keyOf = (l: StockLineDto) => `${l.partId}:${l.locationId}`;
const remaining = computed(() => lines.value.filter((l) => counted.value[keyOf(l)] === undefined));
const current = computed<StockLineDto | undefined>(() => remaining.value[index.value] ?? remaining.value[0]);

/** Counts, never percent — a shelf walk is a list of things, and "30 %" is not a number of bins. */
const shortCount = computed(
  () => lines.value.filter((l) => (counted.value[keyOf(l)] ?? l.quantityOnHand) < l.quantityOnHand).length,
);
const doneCount = computed(() => Object.keys(counted.value).length);

const canReveal = computed(() => session.can("maintenance"));
const blindNow = computed(() => (walk.value?.blind ?? true) && !revealed.value);

/** The half of a walk that is not about shelves: the queue, the strip, the write-then-send order. */
const walkQueue = useWalk(sessionId, "part");
const queued = walkQueue.queued;

/**
 * Send what is on this phone, oldest first. Called on reconnect — and after each entry, which is
 * what makes the queue usually empty, so the strip is honest when it says nothing is waiting.
 */
const drain = () =>
  walkQueue.drain((row) => record.mutateAsync(row.movement as PartMovementInput).then(() => undefined));

const onOnline = () => void drain();
onMounted(() => window.addEventListener("online", onOnline));
onBeforeUnmount(() => window.removeEventListener("online", onOnline));

/** The wake lock is requested from the first tap, because Safari refuses one that is not. */
watch(current, () => void wakeLock.request(), { once: true });

async function commit() {
  const line = current.value;
  if (!line || draft.value === null) return;

  const tier = countVarianceTier(line.quantityOnHand, draft.value);
  if (tier !== "none") {
    // The consequence, not "Are you sure" — the reader has to be able to answer without re-deriving
    // what they are about to do.
    const ok = window.confirm(
      `Record ${draft.value} of ${line.quantityOnHand} for ${line.partNumber}?\n\n` +
        `OK records it. Cancel keeps counting.`,
    );
    if (!ok) return;
  }

  const movement = countStockSchema.safeParse({
    id: crypto.randomUUID(),
    partId: line.partId,
    locationId: line.locationId,
    occurredAt: new Date().toISOString(),
    reason: "counted",
    countedTotal: draft.value,
    countSessionId: sessionId.value,
    blind: blindNow.value,
  });
  if (!movement.success) {
    toast.error("That count could not be recorded", movement.error.issues[0]?.message);
    return;
  }

  const key = keyOf(line);
  const total = draft.value;
  counted.value = { ...counted.value, [key]: total };
  // Above 10 % the row is flagged for a second counter. The movement still commits — a recount is a
  // second `counted` row, not a refusal of the first.
  if (tier === "recount") flagged.value = { ...flagged.value, [key]: true };
  draft.value = null;
  index.value = 0;

  // Written to the phone BEFORE the network is touched. This ordering is the feature, and it lives
  // in `useWalk` because the unit check keeps exactly the same promise.
  await walkQueue.commit(movement.data.id, movement.data as PartMovementInput, () =>
    record.mutateAsync(movement.data as PartMovementInput).then(() => undefined),
  );

  // "Counted 12 · Undo" — one action, and about six seconds to take it. Long enough to notice a
  // wrong number, short enough that it is gone before the next bin.
  toast.push("success", `Counted ${total}`, undefined, {
    duration: 6000,
    action: { label: "Undo", onAction: () => undo(key) },
  });
}

/**
 * Undo is a local retraction of an ENTRY, not a reversal of a ledger row.
 *
 * If the movement is still queued it is dropped outright and never happened. If it has already been
 * sent, the ledger keeps it — an append-only ledger has no eraser (IV011) — and the correction is
 * to count the bin again, which is what removing it from `counted` lets the technician do.
 */
async function undo(key: string) {
  await walkQueue.retract((r) => {
    const m = r.movement as PartMovementInput;
    return `${m.partId}:${m.locationId}` === key;
  });
  const { [key]: _dropped, ...rest } = counted.value;
  counted.value = rest;
  const { [key]: _unflagged, ...restFlags } = flagged.value;
  flagged.value = restFlags;
}

function reveal() {
  revealed.value = true;
  toast.info("Expected figures shown", "Counts from here are recorded as not blind.");
}

interface ReviewRow {
  line: StockLineDto;
  state: "short" | "over" | "match" | "uncounted";
  delta: number;
  recount: boolean;
}

/** Sorted by how far off it is, because that is the order somebody acts in. */
const review = computed<ReviewRow[]>(() =>
  lines.value
    .map((line) => {
      const key = keyOf(line);
      const total = counted.value[key];
      if (total === undefined) {
        return { line, state: "uncounted" as const, delta: 0, recount: false };
      }
      const delta = total - line.quantityOnHand;
      const state = delta < 0 ? ("short" as const) : delta > 0 ? ("over" as const) : ("match" as const);
      return { line, state, delta, recount: Boolean(flagged.value[key]) };
    })
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)),
);

const TONE = { short: "danger", over: "warning", match: "success", uncounted: "neutral" } as const;

/** One word each: "Uncounted" is the honest label for a bin nobody walked, and a delta is its own word. */
const badgeFor = (row: ReviewRow) =>
  row.state === "uncounted" ? "Uncounted" : row.delta === 0 ? "Match" : row.delta > 0 ? `+${row.delta}` : `${row.delta}`;

/** The review as table rows: flat, because `DataTable` reads a cell by key. */
const reviewRows = computed(() =>
  review.value.map((row) => ({
    key: keyOf(row.line),
    partNumber: row.line.partNumber,
    partDescription: row.line.partDescription,
    counted: counted.value[keyOf(row.line)] ?? null,
    expected: row.line.quantityOnHand,
    state: row.state,
    label: badgeFor(row),
    recount: row.recount,
  })),
);

const REVIEW_COLUMNS: DataTableColumn[] = [
  { key: "partNumber", label: "Part number", cellClass: "font-medium text-ink", width: "md" },
  { key: "partDescription", label: "Description", cellClass: "text-ink-secondary" },
  { key: "counted", label: "Counted", numeric: true },
  { key: "expected", label: "Expected", numeric: true },
  { key: "state", label: "Result", width: "sm" },
];

/** "12 of 40 · 3 short · blind" — counts, never percent: "30 %" is not a number of bins. */
const progress = computed(
  () =>
    `${doneCount.value} of ${lines.value.length} counted` +
    (shortCount.value ? ` · ${shortCount.value} short` : "") +
    (blindNow.value ? " · blind" : ""),
);

/**
 * ⚠ Review is reachable BEFORE every line is counted, and that is not a convenience. "Uncounted
 * bins are a choice" is only a choice if the close is reachable while some are uncounted — a bar
 * that offered Review only once the walk was complete would make finishing early impossible, and
 * the way out of that is somebody typing zeros they never counted. Found by
 * `CountSessionPage.test.ts`'s review cases, which could not open the review at all.
 */
const actions = computed<WalkAction[]>(() => {
  if (reviewing.value) {
    return [
      { label: "Keep counting", onClick: () => (reviewing.value = false) },
      { label: "Close the count", primary: true, disabled: closeWalk.isPending.value, onClick: () => void close() },
    ];
  }
  if (current.value) {
    return [
      { label: "Review", onClick: () => (reviewing.value = true) },
      { label: "Record count", primary: true, disabled: draft.value === null, onClick: () => void commit() },
    ];
  }
  return [{ label: "Review and close", primary: true, onClick: () => (reviewing.value = true) }];
});

async function close() {
  const uncounted = review.value.filter((r) => r.state === "uncounted").length;
  const ok = window.confirm(
    uncounted > 0
      ? `Close this count with ${uncounted} shelf line${uncounted === 1 ? "" : "s"} not counted?\n\n` +
          `Uncounted lines are left exactly as they are. Closing cannot be undone.`
      : "Close this count?\n\nClosing cannot be undone; a correction is a new count.",
  );
  if (!ok) return;
  try {
    await closeWalk.mutateAsync({ id: sessionId.value });
    toast.success("Count closed");
    void router.push("/shop");
  } catch (e) {
    toast.error("Could not close the count", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <div class="space-y-6 pb-20 sm:pb-0">
    <AppCallout v-if="walkFailed" tone="danger">That count is not on file.</AppCallout>

    <template v-else-if="walk">
      <PageHeader :title="walk.holderLabel ?? 'Count'" :description="progress">
        <template v-if="walk.status === 'open'" #actions>
          <WalkActions :actions="actions" />
        </template>
      </PageHeader>

      <!-- The promise the queue keeps. Shown only when something is actually waiting: a callout that
           was always there would be furniture, and the one time it matters it would read as chrome. -->
      <AppCallout v-if="queued > 0" tone="warning">
        Saving on this phone — will sync when connected. {{ queued }} waiting.
      </AppCallout>

      <p v-if="walkLoading || stockLoading" class="text-sm text-ink-tertiary">Loading the shelf…</p>

      <BaseCard v-else-if="!reviewing && current">
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0">
            <h2 class="text-sm font-semibold text-ink">Now counting</h2>
            <p class="mt-2 text-base font-semibold text-ink">{{ current.partNumber }}</p>
            <p class="text-sm text-ink-secondary">{{ current.partDescription }}</p>
            <p v-if="!blindNow" class="mt-1 text-sm text-ink-tertiary">Expected {{ current.quantityOnHand }}</p>
          </div>
          <span class="shrink-0 text-xs text-ink-tertiary">{{ remaining.length }} left</span>
        </div>
        <!-- Sized for a thumb, not for a desk: full width on a phone, a hand's width on a monitor. -->
        <div class="mt-4 max-w-md">
          <QuantityStepper v-model="draft" label="Counted" />
        </div>
        <div class="mt-4 flex flex-wrap items-center justify-between gap-2">
          <BaseButton v-if="blindNow && canReveal" variant="ghost" size="sm" @click="reveal">Show expected</BaseButton>
          <span v-else />
          <BaseButton v-if="remaining.length > 1" variant="ghost" size="sm" @click="index = (index + 1) % remaining.length">
            Skip for now
          </BaseButton>
        </div>
      </BaseCard>

      <AppCallout v-else-if="!reviewing" tone="success">
        Every line is counted. Review the variances and close the count.
      </AppCallout>

      <!-- Review: sorted by how far off it is, because that is the order somebody acts in. -->
      <section v-else class="space-y-3">
        <h2 class="text-sm font-semibold text-ink">Review</h2>
        <DataTable :columns="REVIEW_COLUMNS" :rows="reviewRows" row-key="key">
          <template #cell-state="{ row }">
            <span class="inline-flex flex-wrap items-center gap-1">
              <span :class="[BADGE_BASE, toneClass(TONE[row.state as keyof typeof TONE])]">{{ row.label }}</span>
              <span v-if="row.recount" :class="[BADGE_BASE, toneClass('caution')]">Recount by someone else</span>
            </span>
          </template>
        </DataTable>
      </section>

      <WalkActions v-if="walk.status === 'open'" :actions="actions" bar />
    </template>
  </div>
</template>
