<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  countStockSchema,
  countVarianceTier,
  type PartMovementInput,
  type StockLineDto,
} from "@silvicom/shared";
import { AppBadge, AppButton as BaseButton, AppCard as BaseCard } from "@silvicom/ui";
import QuantityStepper from "@/components/ui/QuantityStepper.vue";
import { useWakeLock } from "@/composables/useWakeLock";
import {
  useCloseCountSession,
  useCountSessionQuery,
  useRecordMovement,
  useStockQuery,
} from "@/features/inventory/useInventory";
import { useWalk } from "@/features/inventory/useWalk";
import WalkHeader from "@/features/inventory/WalkHeader.vue";
import { useToastStore } from "@/stores/toast";
import { useSessionStore } from "@/stores/session";

/**
 * A shelf walk, on a phone (INVENTORY-PLAN.md I5 PR 2b; D-INV17, D-INV19, D-INV20, D-INV21).
 *
 * ── IT WAS `pages/CountSessionPage.vue` UNTIL I9, AND MOVED WITHOUT CHANGING ──────────────────
 * D-INV19 says one session component serves parts and units, and I9's unit check is the second
 * body: a shelf count types a quantity per bin and a check taps Found or Not here per item, which
 * are two vocabularies and two ledgers. So the ROUTE component is still one — `CountSessionPage.vue`
 * reads the session's kind and hands off — and what the two share moved to `useWalk` and
 * `WalkHeader.vue`: the write-then-send order, the queue, the strip. Nothing about the walk below
 * changed in the move, and `CountSessionPage.test.ts`'s assertions are what say so.
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

/**
 * ⚠ ONE WORD, and that is not a style choice. `AppBadge` carries `capitalize`, which title-cases
 * every word inside it — so "Not counted" renders as "Not Counted" and breaks the sentence-case copy
 * rule at the pixel while reading correctly in the source. Measured on a real render at iPhone width,
 * 2026-09-09. A single word is immune, and "Uncounted" is the honest label anyway.
 */
const badgeFor = (row: ReviewRow) =>
  row.state === "uncounted" ? "Uncounted" : row.delta === 0 ? "Match" : row.delta > 0 ? `+${row.delta}` : `${row.delta}`;

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
  <div class="space-y-4">
    <div v-if="walkFailed" class="text-sm text-ink">That count is not on file.</div>

    <template v-else-if="walk">
      <!-- Counts, not percent. "12 of 40 · 3 short" is what somebody reads at a glance. -->
      <WalkHeader
        :title="walk.holderLabel ?? 'Count'"
        :progress="`${doneCount} of ${lines.length}${shortCount ? ` · ${shortCount} short` : ''}${blindNow ? ' · blind' : ''}`"
        :queued="queued"
      />

      <div v-if="walkLoading || stockLoading" class="text-sm text-ink-tertiary">Loading the shelf…</div>

      <template v-else-if="!reviewing && current">
        <BaseCard padding="md">
          <p class="text-base font-semibold text-ink">{{ current.partNumber }}</p>
          <p class="mt-0.5 text-sm text-ink-secondary">{{ current.partDescription }}</p>
          <p v-if="!blindNow" class="mt-2 text-sm text-ink-tertiary">
            Expected {{ current.quantityOnHand }}
          </p>
          <div class="mt-4">
            <QuantityStepper v-model="draft" label="Counted" />
          </div>
        </BaseCard>

        <div class="flex items-center justify-between">
          <BaseButton v-if="blindNow && canReveal" variant="ghost" size="sm" @click="reveal">
            Show expected
          </BaseButton>
          <span v-else />
          <BaseButton
            v-if="remaining.length > 1"
            variant="ghost"
            size="sm"
            @click="index = (index + 1) % remaining.length"
          >
            Skip for now
          </BaseButton>
        </div>
      </template>

      <template v-else-if="!reviewing">
        <BaseCard padding="md">
          <p class="text-base font-semibold text-ink">Every line is counted</p>
          <p class="mt-1 text-sm text-ink-tertiary">Review the variances and close the count.</p>
        </BaseCard>
      </template>

      <!-- Review: sorted by how far off it is, because that is the order somebody acts in. -->
      <template v-else>
        <ul class="divide-y divide-edge-subtle">
          <li v-for="row in review" :key="`${row.line.partId}:${row.line.locationId}`" class="flex items-start justify-between gap-3 py-3">
            <div class="min-w-0">
              <p class="text-sm font-medium text-ink">{{ row.line.partNumber }}</p>
              <p class="mt-0.5 truncate text-xs text-ink-tertiary">{{ row.line.partDescription }}</p>
              <AppBadge v-if="row.recount" tone="caution" class="mt-1">Recount by someone else</AppBadge>
            </div>
            <AppBadge :tone="TONE[row.state]">{{ badgeFor(row) }}</AppBadge>
          </li>
        </ul>
      </template>
    </template>

    <Teleport v-if="walk && walk.status === 'open'" to="#shop-action-bar">
      <!--
        ⚠ Review is reachable BEFORE every line is counted, and that is not a convenience.
        "Uncounted bins are a choice" is only a choice if the close is reachable while some are
        uncounted — a bar that offered Review only once the walk was complete would make finishing
        early impossible, and the way out of that is somebody typing zeros they never counted.
        Found by `CountSessionPage.test.ts`'s review cases, which could not open the review at all.
      -->
      <div v-if="!reviewing && current" class="flex gap-2">
        <BaseButton block @click="reviewing = true">Review</BaseButton>
        <BaseButton variant="primary" block :disabled="draft === null" @click="commit">
          Record count
        </BaseButton>
      </div>
      <BaseButton v-else-if="!reviewing" variant="primary" block @click="reviewing = true">
        Review and close
      </BaseButton>
      <div v-else class="flex gap-2">
        <BaseButton block @click="reviewing = false">Keep counting</BaseButton>
        <BaseButton variant="primary" block :disabled="closeWalk.isPending.value" @click="close">
          Close the count
        </BaseButton>
      </div>
    </Teleport>
  </div>
</template>
