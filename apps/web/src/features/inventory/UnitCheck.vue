<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  UNIT_KIND_LABELS,
  assetMovementInputSchema,
  type AssetDto,
  type AssetMovementInput,
  type UnitKitLineDto,
} from "@silvicom/shared";
import { AppButton as BaseButton, AppCallout, AppCard as BaseCard } from "@silvicom/ui";
import PageHeader from "@/components/ui/PageHeader.vue";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { useWakeLock } from "@/composables/useWakeLock";
import { useCloseCountSession, useCountSessionQuery } from "@/features/inventory/useInventory";
import { useAssetsQuery, useMoveAsset } from "@/features/inventory/useAssets";
import { useUnitKitQuery } from "@/features/inventory/useUnits";
import { useWalk } from "@/features/inventory/useWalk";
import WalkActions, { type WalkAction } from "@/features/inventory/WalkActions.vue";
import { useToastStore } from "@/stores/toast";

/**
 * A truck's kit, walked (INVENTORY-PLAN.md I9; D-INV17 as amended 2026-09-10, D-INV19, D-INV24).
 *
 * ── A PAGE IN THE APP'S OWN SHELL, SINCE 2026-09-10 ───────────────────────────────────────────
 * "Check this unit" opens this from the unit's page at a desk as often as from a phone in a yard,
 * and the owner found the phone-only shell it shipped in shared nothing with the page they came
 * from. So it follows the product's anatomy — `PageHeader`, a card for the question, cards with
 * divided rows for the buckets, a table for the review — and keeps the phone's bottom bar through
 * `WalkActions.vue` below `sm`. `ShelfWalk.vue` carries the full reasoning.
 *
 * ── THE THREE BUCKETS ARE STATES OF THE WALK, NOT LEDGER ROWS ─────────────────────────────────
 * Found / Not yet / Unexpected describe where the technician has got to. Only two of the answers
 * write anything: saying a thing is NOT here records a claim (`reported_missing`, which leaves the
 * holder exactly where it was — D-INV24, because a fridge missing from 654 is still 654's fridge),
 * and saying a thing recorded elsewhere IS here moves it (`found`). Confirming what the system
 * already believes writes nothing at all, because nothing changed — and a ledger row per confirmed
 * strap would bury the two rows that mean something.
 *
 * ── "NOT HERE" IS A REPORT AND NEVER A REMOVAL ────────────────────────────────────────────────
 * The tempting alternative — clear the holder so the truck reads correctly — destroys the only fact
 * that explains the gap. A kit check's whole output is "654 is missing its fridge", and an asset
 * with no holder cannot say which truck it went missing from.
 *
 * ── THE SAME PROMISE THE SHELF WALK MAKES ─────────────────────────────────────────────────────
 * Written to this phone before the network is touched, replayed on reconnect, and every row carries
 * the movement id minted for it (D-INV27). That half lives in `useWalk`, shared with `ShelfWalk`,
 * so a bay with no signal behaves identically on both.
 */

const route = useRoute();
const router = useRouter();
const toast = useToastStore();
const sessionId = computed(() => String(route.params.sessionId ?? ""));

const { data: walk, isLoading: walkLoading, isError: walkFailed } = useCountSessionQuery(sessionId);
/** The roster's word — a reefer is a `trailer` — because that is which table the id is in. */
const rosterKind = computed<"tractor" | "trailer">(() => (walk.value?.vehicleId ? "tractor" : "trailer"));
const unitId = computed(() => walk.value?.vehicleId ?? walk.value?.trailerId ?? "");
const { data: kit, isLoading: kitLoading } = useUnitKitQuery(rosterKind, unitId);

const move = useMoveAsset();
const closeWalk = useCloseCountSession();
const wakeLock = useWakeLock();
const walkQueue = useWalk(sessionId, "asset");
const queued = walkQueue.queued;

const drain = () =>
  walkQueue.drain((row) => move.mutateAsync(row.movement as AssetMovementInput).then(() => undefined));
const onOnline = () => void drain();
onMounted(() => window.addEventListener("online", onOnline));
onBeforeUnmount(() => window.removeEventListener("online", onOnline));

/** What has been answered in THIS walk: asset id → what the technician said. */
const answered = ref<Record<string, "found" | "missing">>({});
const reviewing = ref(false);
/** The shortfall line whose candidates are open. One at a time — a phone shows one question. */
const looking = ref<string | null>(null);

const held = computed<AssetDto[]>(() => kit.value?.assets ?? []);

/** "Truck 654" — the unit page's own title, so the two screens read as one thing. */
const title = computed(() => {
  const unit = kit.value?.unit;
  return unit ? `${UNIT_KIND_LABELS[unit.kind]} ${unit.unitNumber}` : (walk.value?.holderLabel ?? "Unit check");
});
const lines = computed<UnitKitLineDto[]>(() => kit.value?.unit.lines ?? []);
const shortLines = computed(() => lines.value.filter((l) => l.delta < 0));
const unexpected = computed(() => lines.value.filter((l) => l.expected === 0 && l.held > 0));

const remaining = computed(() => held.value.filter((a) => answered.value[a.id] === undefined));
const missingCount = computed(() => Object.values(answered.value).filter((v) => v === "missing").length);
const doneCount = computed(() => Object.keys(answered.value).length);

/** The wake lock is requested from the first tap, because Safari refuses one that is not. */
watch(remaining, () => void wakeLock.request(), { once: true });

/** Candidates for "it's here now": this type's assets, wherever they are recorded, minus this unit's. */
const candidateFilter = computed(() => ({ assetTypeId: looking.value ?? undefined, page: 1 }));
const candidates = useAssetsQuery(candidateFilter);
const elsewhere = computed<AssetDto[]>(() =>
  (candidates.data.value?.assets ?? []).filter((a) => a.holder.id !== unitId.value && a.status !== "retired"),
);

/** One movement, written down first and sent second — `useWalk` keeps that order for both walks. */
async function record(input: unknown, said: string) {
  const parsed = assetMovementInputSchema.safeParse(input);
  if (!parsed.success) {
    toast.error("That could not be recorded", parsed.error.issues[0]?.message);
    return false;
  }
  const movement = parsed.data;
  await walkQueue.commit(movement.id, movement, () => move.mutateAsync(movement).then(() => undefined));
  toast.push("success", said, undefined, {
    duration: 6000,
    action: { label: "Undo", onAction: () => void undo(movement.assetId, movement.id) },
  });
  return true;
}

/** Confirming what the system already believes writes NOTHING — nothing changed. */
function markFound(asset: AssetDto) {
  answered.value = { ...answered.value, [asset.id]: "found" };
}

async function markMissing(asset: AssetDto) {
  answered.value = { ...answered.value, [asset.id]: "missing" };
  const ok = await record(
    {
      id: crypto.randomUUID(),
      assetId: asset.id,
      reason: "reported_missing",
      countSessionId: sessionId.value,
      occurredAt: new Date().toISOString(),
    },
    `${asset.displayNo} reported missing`,
  );
  if (!ok) answered.value = { ...answered.value, [asset.id]: "found" };
}

/** It is on the truck after all — one tap, and the ledger says where it came from. */
async function itsHereNow(asset: AssetDto) {
  looking.value = null;
  await record(
    {
      id: crypto.randomUUID(),
      assetId: asset.id,
      reason: "found",
      ...(rosterKind.value === "tractor" ? { toVehicleId: unitId.value } : { toTrailerId: unitId.value }),
      countSessionId: sessionId.value,
      occurredAt: new Date().toISOString(),
    },
    `${asset.displayNo} is on this unit`,
  );
}

/**
 * Undo retracts an unsent row and the local answer with it. A row already sent stays — an
 * append-only ledger has no eraser (`IV021`) — and the correction is to say the opposite, which
 * removing the answer lets the technician do.
 */
async function undo(assetId: string, movementId: string) {
  await walkQueue.retract((r) => r.id === movementId);
  const { [assetId]: _dropped, ...rest } = answered.value;
  answered.value = rest;
}

/** "1 of 2 checked · 1 missing" — counts, never percent. */
const progress = computed(
  () => `${doneCount.value} of ${held.value.length} checked` + (missingCount.value ? ` · ${missingCount.value} missing` : ""),
);

/**
 * Review is reachable before every item is looked at, for the reason the shelf walk records:
 * "items nobody looked at are a choice" is only a choice if closing early is possible.
 */
const actions = computed<WalkAction[]>(() => {
  if (reviewing.value) {
    return [
      { label: "Keep checking", onClick: () => (reviewing.value = false) },
      { label: "Close the check", primary: true, disabled: closeWalk.isPending.value, onClick: () => void close() },
    ];
  }
  if (remaining.value.length) return [{ label: "Review", onClick: () => (reviewing.value = true) }];
  return [{ label: "Review and close", primary: true, onClick: () => (reviewing.value = true) }];
});

/** The review as one table: every item with its answer, then every kind still short. */
const reviewRows = computed(() => [
  ...held.value.map((a) => ({
    key: a.id,
    what: a.assetTypeName,
    detail: a.displayNo,
    label: answered.value[a.id] === "missing" ? "Missing" : answered.value[a.id] ? "Here" : "Unchecked",
    tone: answered.value[a.id] === "missing" ? "danger" : answered.value[a.id] ? "success" : "neutral",
  })),
  ...shortLines.value.map((l) => ({
    key: `short:${l.assetTypeId}`,
    what: l.assetTypeName,
    detail: `${l.held} of ${l.expected}`,
    label: "Short",
    tone: "danger",
  })),
]);

const REVIEW_COLUMNS: DataTableColumn[] = [
  { key: "what", label: "What", cellClass: "font-medium text-ink", width: "md" },
  { key: "detail", label: "Which", cellClass: "text-ink-secondary" },
  { key: "label", label: "Result", width: "sm" },
];

async function close() {
  const notYet = remaining.value.length;
  const ok = window.confirm(
    notYet > 0
      ? `Close this check with ${notYet} item${notYet === 1 ? "" : "s"} not looked at?\n\n` +
          `Items nobody looked at are left exactly as they are. Closing cannot be undone.`
      : "Close this check?\n\nClosing cannot be undone; a correction is a new check.",
  );
  if (!ok) return;
  try {
    await closeWalk.mutateAsync({ id: sessionId.value });
    toast.success("Check closed");
    void router.push("/shop/units");
  } catch (e) {
    toast.error("Could not close the check", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <div class="space-y-6 pb-20 sm:pb-0">
    <AppCallout v-if="walkFailed" tone="danger">That check is not on file.</AppCallout>

    <template v-else-if="walk">
      <PageHeader :title="title" :description="progress">
        <template v-if="walk.status === 'open'" #actions>
          <WalkActions :actions="actions" />
        </template>
      </PageHeader>

      <AppCallout v-if="queued > 0" tone="warning">
        Saving on this phone — will sync when connected. {{ queued }} waiting.
      </AppCallout>

      <p v-if="walkLoading || kitLoading" class="text-sm text-ink-tertiary">Loading the kit…</p>

      <template v-else-if="!reviewing">
        <!-- What the system says is on this unit: one card, one question, two answers. -->
        <BaseCard v-for="asset in remaining.slice(0, 1)" :key="asset.id">
          <div class="flex items-start justify-between gap-4">
            <div class="min-w-0">
              <h2 class="text-sm font-semibold text-ink">Is this on the unit?</h2>
              <p class="mt-2 text-base font-semibold text-ink">{{ asset.assetTypeName }}</p>
              <p class="text-sm text-ink-secondary">{{ asset.displayNo }} · {{ asset.name }}</p>
            </div>
            <span class="shrink-0 text-xs text-ink-tertiary">{{ remaining.length }} left</span>
          </div>
          <div class="mt-4 flex gap-2">
            <BaseButton block variant="primary" @click="markFound(asset)">It's here</BaseButton>
            <BaseButton block @click="markMissing(asset)">Not here</BaseButton>
          </div>
        </BaseCard>

        <AppCallout v-if="!remaining.length" tone="success">
          Every item has been looked at. Review what is short and close the check.
        </AppCallout>

        <!-- Short of something the kit asks for: the one-tap way to say it turned up. -->
        <section v-if="shortLines.length" class="space-y-3">
          <h2 class="text-sm font-semibold text-ink">Short of</h2>
          <BaseCard padding="none">
            <ul class="divide-y divide-edge-subtle">
              <li v-for="line in shortLines" :key="line.assetTypeId" class="px-5 py-3">
                <div class="flex items-center justify-between gap-3">
                  <p class="text-sm text-ink">
                    {{ line.assetTypeName }}
                    <span class="text-ink-tertiary">· {{ line.held }} of {{ line.expected }}</span>
                  </p>
                  <!-- NOT "It's here", which is the item card's answer above: a real render carried
                       both labels on one screen meaning two different things. This one opens the
                       list of the ones recorded somewhere else. -->
                  <BaseButton size="sm" variant="ghost" @click="looking = looking === line.assetTypeId ? null : line.assetTypeId">
                    {{ looking === line.assetTypeId ? "Close" : "One turned up" }}
                  </BaseButton>
                </div>
                <!-- Recorded on another unit or in a bay. One tap moves it here and the ledger keeps
                     where it came from — the whole answer to "which one, and from where". -->
                <ul v-if="looking === line.assetTypeId" class="mt-2 space-y-1">
                  <li v-for="a in elsewhere" :key="a.id">
                    <BaseButton block size="sm" @click="itsHereNow(a)">
                      {{ a.displayNo }} — {{ a.holder.label ?? "not placed" }}
                    </BaseButton>
                  </li>
                  <li v-if="!elsewhere.length" class="text-xs text-ink-tertiary">
                    Nothing of this kind is recorded anywhere else. Add it on Assets first.
                  </li>
                </ul>
              </li>
            </ul>
          </BaseCard>
        </section>

        <!-- Carried but expected by nothing: the bucket only a walk can find. -->
        <section v-if="unexpected.length" class="space-y-3">
          <h2 class="text-sm font-semibold text-ink">Not in the kit</h2>
          <BaseCard padding="none">
            <ul class="divide-y divide-edge-subtle text-sm">
              <li v-for="line in unexpected" :key="line.assetTypeId" class="px-5 py-3 text-ink-secondary">
                {{ line.assetTypeName }} · {{ line.held }} carried
              </li>
            </ul>
          </BaseCard>
        </section>
      </template>

      <!-- Review: what is missing and what is still short, which is what somebody acts on. -->
      <section v-else class="space-y-3">
        <h2 class="text-sm font-semibold text-ink">Review</h2>
        <DataTable :columns="REVIEW_COLUMNS" :rows="reviewRows" row-key="key">
          <template #cell-label="{ row }">
            <span :class="[BADGE_BASE, toneClass(row.tone)]">{{ row.label }}</span>
          </template>
        </DataTable>
      </section>

      <WalkActions v-if="walk.status === 'open'" :actions="actions" bar />
    </template>
  </div>
</template>
