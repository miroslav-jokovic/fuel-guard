<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  KIT_RULES_SHOWN,
  UNIT_KIND_LABELS,
  assetMovementInputSchema,
  type AssetDto,
  type AssetMovementInput,
  type UnitKitLineDto,
} from "@silvicom/shared";
import {
  AppButton as BaseButton,
  AppCallout,
  AppIcon,
  AppCard as BaseCard,
  QueryState,
  DataTable,
  type DataTableColumn,
  useConfirm,
} from "@silvicom/ui";
import { ScanIcon } from "@silvicom/ui/icons";
import PageHeader from "@/components/ui/PageHeader.vue";
import BarcodeCamera from "@/components/BarcodeCamera.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { useWakeLock } from "@/composables/useWakeLock";
import { useCloseCountSession, useCountSessionQuery } from "@/features/inventory/useInventory";
import { useAssetsQuery, useMoveAsset } from "@/features/inventory/useAssets";
import { SCAN_PAGE_READER } from "@/features/inventory/shopBarcodeFormats";
import type { AssignTarget } from "@/features/inventory/assignLine";
import { useCheckScan } from "@/features/inventory/useCheckScan";
import { useStartUnitCheck } from "@/features/inventory/useStartUnitCheck";
import { useUnitKitQuery } from "@/features/inventory/useUnits";
import { useWalk } from "@/features/inventory/useWalk";
import WalkActions, { type WalkAction } from "@/components/WalkActions.vue";
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
const ask = useConfirm();
const sessionId = computed(() => String(route.params.sessionId ?? ""));

const { data: walk } = useCountSessionQuery(sessionId);
/** The roster's word — a reefer is a `trailer` — because that is which table the id is in. */
const rosterKind = computed<"tractor" | "trailer">(() => (walk.value?.vehicleId ? "tractor" : "trailer"));
const unitId = computed(() => walk.value?.vehicleId ?? walk.value?.trailerId ?? "");
// The kit's own failure is read too (D-US5): with no kit there is nothing left to look at, and a
// failed read used to fall through to "Every item has been looked at" for a unit nobody had checked.
const {
  data: kit, isLoading: kitLoading, isError: kitFailed, error: kitError, isFetching: kitFetching, refetch: refetchKit,
} = useUnitKitQuery(rosterKind, unitId);

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
// "Missing" kinds and "Not on the list" are Should carry's — a shortfall against a rule and a thing no
// rule expects — and hidden with it (EA2/EA3, `KIT_RULES_SHOWN`): with no rules every carried thing
// read as "Not on the list", and the 200-tablet default would have read as 199 missing.
const shortLines = computed(() => (KIT_RULES_SHOWN ? lines.value.filter((l) => l.delta < 0) : []));
const unexpected = computed(() => (KIT_RULES_SHOWN ? lines.value.filter((l) => l.expected === 0 && l.held > 0) : []));

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
async function record(input: unknown, said: string | null) {
  const parsed = assetMovementInputSchema.safeParse(input);
  if (!parsed.success) {
    toast.error("That could not be recorded", parsed.error.issues[0]?.message);
    return false;
  }
  const movement = parsed.data;
  await walkQueue.commit(movement.id, movement, () => move.mutateAsync(movement).then(() => undefined));
  // Close's "report the rest not found" writes several at once, and says so once (`close`).
  if (said === null) return true;
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

/** EA3: a scan ticks an item off, or says where it is recorded — `useCheckScan` has the reasoning. */
const target = computed<AssignTarget>(() => ({
  kind: rosterKind.value === "tractor" ? "vehicle" : "trailer",
  id: unitId.value,
  label: title.value,
}));
const cameraOpen = ref(false);
const { lastScan, onScan, SCAN_TONE } = useCheckScan({
  held,
  answered,
  target,
  markFound,
  enabled: computed(() => walk.value?.status === "open" && !reviewing.value && !cameraOpen.value),
});

/** DE5: another unit's label scanned here — its own check, started or resumed (R9); this one stays open. */
const otherCheck = useStartUnitCheck();
function checkOther(unit: AssignTarget) {
  lastScan.value = null;
  void otherCheck.startCheck(unit.kind === "vehicle" ? "tractor" : "trailer", unit.id);
}

async function moveHere(asset: AssetDto) {
  lastScan.value = null;
  await itsHereNow(asset);
  answered.value = { ...answered.value, [asset.id]: "found" };
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
  { key: "what", label: "What", card: "title", cellClass: "font-medium text-ink", width: "md" },
  { key: "detail", label: "Which", card: "sentence", cellClass: "text-ink-secondary" },
  { key: "label", label: "Result", card: "meta", width: "sm" },
];

/**
 * Close. Since EA3 (proposal §3.5, owner 2026-10-30) whatever nobody scanned or ticked is reported
 * NOT FOUND on the way out — "scan everything you see" means what was not seen is missing — and the
 * dialog names how many before anything is written. Each is the same `reported_missing` row *Not
 * here* writes: the holder does not move (D-INV24), it is still this truck's, missing from it. Until
 * EA3 those were left as they were, which made a check that scanned nothing indistinguishable from one
 * that found everything.
 */
async function close() {
  const notYet = remaining.value.length;
  // D-US7: the product's dialog, red because closing cannot be undone.
  const ok = await ask(
    notYet > 0
      ? {
          title: `Report ${notYet} not found and close?`,
          message: `${notYet === 1 ? "The item" : `The ${notYet} items`} nobody scanned or ticked will be reported missing from ${title.value}. Closing cannot be undone.`,
          confirmLabel: "Report and close",
          tone: "danger",
        }
      : {
          title: "Close this check?",
          message: "Closing cannot be undone; a correction is a new check.",
          confirmLabel: "Close check",
          tone: "danger",
        },
  );
  if (!ok) return;
  for (const asset of [...remaining.value]) {
    answered.value = { ...answered.value, [asset.id]: "missing" };
    const reported = await record(
      { id: crypto.randomUUID(), assetId: asset.id, reason: "reported_missing", countSessionId: sessionId.value, occurredAt: new Date().toISOString() },
      null,
    );
    if (!reported) return;
  }
  try {
    await closeWalk.mutateAsync({ id: sessionId.value });
    toast.success(notYet > 0 ? `Check closed — ${notYet} reported missing` : "Check closed");
    // Back to the truck it was started from (EA3: the truck's and trailer's cards start checks now).
    void router.push({ name: "unit", params: { kind: rosterKind.value, id: unitId.value }, query: { tab: "equipment" } });
  } catch (e) {
    toast.error("Could not close the check", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <div class="space-y-6">
    <!-- The walk's own load and failure are drawn by CountSessionPage, the one place that reads the
         session and decides which body to mount (D-INV19); this body is mounted only once the walk
         has arrived, so it draws no second "not on file" of its own (D-US5). -->
    <template v-if="walk">
      <PageHeader :title="title" :description="progress">
        <template v-if="walk.status === 'open'" #actions>
          <WalkActions :actions="actions" />
        </template>
      </PageHeader>

      <AppCallout v-if="queued > 0" tone="warning">
        Saving on this phone — will sync when connected. {{ queued }} waiting.
      </AppCallout>

      <QueryState
        :loading="kitLoading"
        :error="kitFailed ? kitError : null"
        :retrying="kitFetching"
        loading-text="Loading the kit…"
        error-text="Could not load the list."
        @retry="refetchKit()"
      >
      <template v-if="!reviewing">
        <!-- EA3: the scanner's place on this screen — what to do, the camera, and what the last scan found. -->
        <div v-if="walk.status === 'open'" class="rounded-control bg-surface-subtle px-4 py-3 ring-1 ring-edge" data-test="check-scan">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <p class="text-sm text-ink-secondary">Scan each label to tick it off — or answer below.</p>
            <BaseButton size="sm" variant="secondary" data-test="check-camera" @click="cameraOpen = true">
              <AppIcon :icon="ScanIcon" class="size-5" aria-hidden="true" /> Use the camera
            </BaseButton>
          </div>
          <p v-if="lastScan" class="mt-2 text-sm" :class="SCAN_TONE[lastScan.tone]" aria-live="polite" data-test="check-last-scan">
            {{ lastScan.text }}
          </p>
          <BaseButton v-if="lastScan?.moveable" size="sm" class="mt-2" data-test="check-move-here" @click="moveHere(lastScan.moveable)">
            Move it here
          </BaseButton>
          <BaseButton v-if="lastScan?.otherUnit" size="sm" class="mt-2" data-test="check-other-unit" @click="checkOther(lastScan.otherUnit)">
            Check {{ lastScan.otherUnit.label }}
          </BaseButton>
        </div>

        <!-- What the system says is on this unit: one card, one question, two answers. -->
        <BaseCard v-for="asset in remaining.slice(0, 1)" :key="asset.id">
          <div class="flex items-start justify-between gap-4">
            <div class="min-w-0">
              <h2 class="text-sm font-semibold text-ink">Is this on board?</h2>
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
          <h2 class="text-sm font-semibold text-ink">Missing</h2>
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
          <h2 class="text-sm font-semibold text-ink">Not on the list</h2>
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
        <!-- ui-adoption: never-paged — one truck's kit under review — the handful of things it should carry. -->
        <DataTable :columns="REVIEW_COLUMNS" :rows="reviewRows" row-key="key" empty-text="Nothing to review.">
          <template #cell-label="{ row }">
            <span :class="[BADGE_BASE, toneClass(row.tone)]">{{ row.label }}</span>
          </template>
        </DataTable>
      </section>
      </QueryState>

      <WalkActions v-if="walk.status === 'open'" :actions="actions" bar />
      <!-- Kept open: a truck's worth of labels is many reads. -->
      <BarcodeCamera
        v-if="cameraOpen"
        title="Scan labels"
        hint="Hold each label inside the box. Close when you are done."
        :reader="SCAN_PAGE_READER"
        @read="(text) => void onScan(text)"
        @close="cameraOpen = false"
      />
    </template>
  </div>
</template>
