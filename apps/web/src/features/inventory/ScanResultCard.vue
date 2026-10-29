<script setup lang="ts">
import { computed } from "vue";
import { IMEI_REFUSAL, readStickerCode, type AssetDto, type ScanResult, type StockLineDto } from "@silvicom/shared";
import type { AssetFormSeed } from "@/features/inventory/AssetForm.vue";
import { AppBadge, AppButton as BaseButton } from "@silvicom/ui";
import { BADGE_BASE, assetStatusBadge, toneClass } from "@/lib/badges";
import ScanStockLine from "@/features/inventory/ScanStockLine.vue";
import type { DeskVerb } from "@/features/inventory/MovementDrawer.vue";

/**
 * What the scan found, and what can be done about it (D-INV7; INVENTORY-PLAN.md I6).
 *
 * ── THE FIVE ANSWERS ARE FIVE SCREENS, NOT ONE SCREEN WITH AN ERROR STATE ─────────────────────
 * `ScanResult` is a discriminated union of five members and three of them are "found something".
 * The two that are not — `unknown_tag` and `malformed` — arrive as ordinary 200s for the reason
 * `inventoryScanContract.ts` sets out at length: on a shop floor they are ordinary events with
 * different useful next actions, and collapsing them into one "not found" would throw away the
 * difference between a label from a newer version of the product and a barcode that belongs to
 * something else entirely. This component is where that difference becomes different words.
 *
 * ── A UPC WITH NO PART IS THE RECEIVING DESK'S MOST COMMON SCAN, AND IT IS NOT A FAILURE ──────
 * A technician opening a carton from a new supplier scans a barcode the shop has never seen. The
 * shape research §2.5 found in every good product is "attach or create" with the code kept, not a
 * shrug — so `malformed` offers to create a part carrying that barcode, and the code travels into
 * the form rather than being read off the screen and retyped. That is the whole reason every member
 * of the union carries `code`.
 *
 * ── WHY THIS COMPONENT DECIDES NOTHING AND OPENS NOTHING ──────────────────────────────────────
 * It emits an intent and the page owns the drawers. The drawers are `MovementDrawer` and
 * `AssetMoveDrawer` — the same two the desk screens use, unchanged — because a movement recorded
 * from a scan and a movement recorded from the part detail must be the same row written the same
 * way, and a second form for the phone would be a second place for D-INV27's id rule to be got
 * wrong. Reuse here is not tidiness; it is the idempotency key having one owner.
 *
 * ── "NOT RECOGNISED" READS THE CODE FIRST (M9b, 2026-10-29) ───────────────────────────────────
 * A tablet's sticker scanned here used to land as "No part carries this barcode — create a part",
 * which was wrong twice: a tablet is equipment, and since M8 shop parts are FleetPal's and are not
 * created here. The API looks a sticker's IMEI and serial up before it says `malformed`; when nothing
 * matched, `readStickerCode` says what the code IS, and the card offers what fits — an IMEI is a
 * tablet not on file yet ("Add this tablet", the IMEI filled in), a misread IMEI is refused with the
 * form's own sentence, the SIM's number is named, and anything else gets "Add equipment" with it.
 *
 * ── A DRIVER'S TABLET NAMES THE DRIVER AND OFFERS RETURN (DE2b, D-DE1/D-DE3) ──────────────────
 * A tablet handed in at the shop window is scanned here, so the card says whose it is ("Dana Reyes's
 * tablet") and its first button is Return to the shop — the move drawer opens on Return for a driver's
 * tablet. *Not returned* (the driver has left, read by the API off the driver's status) is the
 * danger-tone pill, because that is the tablet the office has been chasing.
 */

export type ScanAction =
  | { kind: "stock"; verb: DeskVerb; line: StockLineDto }
  | { kind: "asset"; mode: "move" | "report"; asset: AssetDto }
  | { kind: "open-part"; partId: string }
  | { kind: "create-asset"; fill: AssetFormSeed };

/**
 * `canManage` hides every write. The screen is reachable at `maintenance: view`, and a verb a role
 * cannot perform is a button that ends in a 403 (DRIVER-EQUIPMENT-AND-UNIT-TAGS-PLAN.md §5, R12).
 * The read half — what this is, where it is, how many — is exactly what a viewer came for.
 */
const props = defineProps<{ result: ScanResult; canManage: boolean }>();
const emit = defineEmits<{ action: [action: ScanAction] }>();

const statusBadge = computed(() =>
  props.result.kind === "asset" ? assetStatusBadge(props.result.asset.status) : null,
);

/**
 * Where an asset is, in one sentence a person would say out loud.
 *
 * The driver is shown by INFERENCE and never as custody (D-INV3): inventory belongs to the unit,
 * nobody signs for it, and the name is here because "654 — Dana Reyes" is how a technician finds
 * the truck in the yard, not because Dana is answerable for the fridge.
 */
/** What an unrecognised code is, off a device's sticker — only read when nothing matched it. */
const sticker = computed(() => (props.result.kind === "malformed" ? readStickerCode(props.result.code) : null));
const fill = computed<AssetFormSeed>(() => {
  const s = sticker.value;
  if (!s) return {};
  if (s.kind === "imei") return { imei: s.imei };
  if (s.kind === "serial") return { serialNumber: s.serial };
  if (s.kind === "model") return { model: s.model, manufacturer: s.manufacturer };
  return {};
});

const holderLine = computed(() => {
  if (props.result.kind !== "asset") return null;
  // The holder object always exists; "held by nobody" is spelled as a null LABEL, because the API
  // assembles it from whichever of the three columns is set and an unassigned asset sets none.
  const h = props.result.asset.holder;
  // A driver HOLDS a tablet (D-DE1) — custody, unlike the truck's inferred driver below.
  if (h.kind === "driver") return `${h.label ?? "A driver"}'s ${props.result.asset.assetTypeName.toLowerCase()}`;
  if (!h.label) return "Not placed anywhere";
  return h.inferredDriverName ? `${h.label} — ${h.inferredDriverName}` : h.label;
});
</script>

<template>
  <!-- ── a shelf ───────────────────────────────────────────────────────────────────────────── -->
  <section v-if="result.kind === 'stock_line'" class="space-y-3">
    <div>
      <p class="text-base font-semibold text-ink">{{ result.stockLine.partDescription }}</p>
      <p class="mt-0.5 font-mono text-xs text-ink-secondary">{{ result.stockLine.partNumber }}</p>
    </div>
    <ScanStockLine
      :line="result.stockLine"
      :can-manage="canManage"
      @verb="emit('action', { kind: 'stock', verb: $event, line: result.stockLine })"
    />
  </section>

  <!-- ── a thing with a serial number ──────────────────────────────────────────────────────── -->
  <section v-else-if="result.kind === 'asset'" class="space-y-3">
    <div>
      <div class="flex items-center gap-2">
        <p class="min-w-0 truncate text-base font-semibold text-ink">{{ result.asset.name }}</p>
        <AppBadge v-if="statusBadge" :tone="statusBadge.tone">{{ statusBadge.label }}</AppBadge>
        <span v-if="result.asset.holder.notReturned" :class="[BADGE_BASE, toneClass('danger')]">Not returned</span>
      </div>
      <p class="mt-0.5 font-mono text-xs text-ink-secondary">
        {{ result.asset.displayNo }} · {{ result.asset.assetTypeName }}
      </p>
      <p class="mt-2 text-sm text-ink-secondary">{{ holderLine }}</p>
    </div>
    <div v-if="canManage" class="grid grid-cols-2 gap-2">
      <BaseButton block variant="primary" @click="emit('action', { kind: 'asset', mode: 'move', asset: result.asset })">
        {{ result.asset.holder.kind === "driver" ? "Return to shop" : "Move" }}
      </BaseButton>
      <BaseButton block @click="emit('action', { kind: 'asset', mode: 'report', asset: result.asset })">
        Report
      </BaseButton>
    </div>
  </section>

  <!-- ── a supplier barcode we know ────────────────────────────────────────────────────────── -->
  <section v-else-if="result.kind === 'part_by_upc'" class="space-y-3">
    <div>
      <p class="text-base font-semibold text-ink">{{ result.part.description }}</p>
      <p class="mt-0.5 font-mono text-xs text-ink-secondary">{{ result.part.partNumber }}</p>
    </div>
    <ScanStockLine
      v-for="line in result.stockLines"
      :key="`${line.partId}:${line.locationId}`"
      :line="line"
      :can-manage="canManage"
      @verb="emit('action', { kind: 'stock', verb: $event, line })"
    />
    <!-- A part the catalogue knows and no shelf holds. Real, and fixable from the part's own page,
         which is where a shelf is added — not from here, because adding a shelf is a decision about
         where stock lives and not something to do standing in front of a carton. -->
    <div v-if="!result.stockLines.length" class="rounded-control bg-surface-subtle px-3 py-3 ring-1 ring-edge">
      <p class="text-sm text-ink">This part is not on any shelf yet.</p>
      <BaseButton block class="mt-3" @click="emit('action', { kind: 'open-part', partId: result.part.id })">
        Open the part
      </BaseButton>
    </div>
  </section>

  <!-- ── one of ours, arriving garbled ──────────────────────────────────────────────────────────
       `tagKind: null` is the API's word for "starts like our label but did not parse" — a keyboard
       layout turning the colons into something else (§5, R3). It names the fix, because the label
       is fine and re-scanning will fail identically until the setting changes. -->
  <section v-else-if="result.kind === 'unknown_tag' && result.tagKind === null" class="space-y-2">
    <p class="text-base font-semibold text-ink">The scanner misread that label</p>
    <p class="text-sm text-ink-secondary">
      It starts like one of our labels but arrived garbled. Set the scanner and this device to the
      US English keyboard layout, then scan again — or type the code printed on the label below.
    </p>
    <p class="font-mono text-xs text-ink-tertiary">{{ result.code }}</p>
  </section>

  <!-- ── one of ours, pointing at nothing here ─────────────────────────────────────────────── -->
  <section v-else-if="result.kind === 'unknown_tag'" class="space-y-2">
    <p class="text-base font-semibold text-ink">That label is not on file</p>
    <!-- A kind with no resolver and a tag whose id is not this org's answer identically, on purpose:
         telling them apart would confirm another carrier's label to whoever scanned it. -->
    <p class="text-sm text-ink-secondary">
      It is one of our labels, but nothing in this account matches it. It may belong to another
      account, or to a newer version of the app.
    </p>
    <p class="font-mono text-xs text-ink-tertiary">{{ result.code }}</p>
  </section>

  <!-- ── a tablet's IMEI that no equipment carries yet (M9b) ───────────────────────────────── -->
  <section v-else-if="sticker?.kind === 'imei'" class="space-y-3" data-test="scan-new-tablet">
    <div>
      <p class="text-base font-semibold text-ink">A tablet not on file yet</p>
      <p class="mt-1 text-sm text-ink-secondary">No equipment has this IMEI.</p>
      <p class="mt-2 font-mono text-xs text-ink-tertiary">IMEI {{ sticker.imei }}</p>
    </div>
    <BaseButton v-if="canManage" block variant="primary" @click="emit('action', { kind: 'create-asset', fill })">
      Add this tablet
    </BaseButton>
  </section>

  <section v-else-if="sticker?.kind === 'bad_imei'" class="space-y-2">
    <p class="text-base font-semibold text-danger-700">{{ IMEI_REFUSAL }}</p>
    <p class="text-sm text-ink-secondary">Fifteen digits arrived, but the last one does not check out — the barcode was misread.</p>
    <p class="font-mono text-xs text-ink-tertiary">{{ result.code }}</p>
  </section>

  <section v-else-if="sticker?.kind === 'sim'" class="space-y-2">
    <p class="text-base font-semibold text-ink">That is the SIM card's number</p>
    <p class="text-sm text-ink-secondary">It is not stored. Scan the barcode marked IMEI to find or add the tablet.</p>
    <p class="font-mono text-xs text-ink-tertiary">{{ result.code }}</p>
  </section>

  <!-- ── not ours, and nothing on file carries it ──────────────────────────────────────────────
       No "create a part" (M8): shop parts are FleetPal's. A serial or a model may be a device the
       shop has not entered, so those offer Add equipment with the code in its field. -->
  <section v-else class="space-y-3">
    <div>
      <p class="text-base font-semibold text-ink">Not recognised</p>
      <p class="mt-1 text-sm text-ink-secondary">
        No equipment and no shop part carries this code. Shop parts come from FleetPal.
      </p>
      <p class="mt-2 font-mono text-xs text-ink-tertiary">{{ result.code }}</p>
    </div>
    <BaseButton
      v-if="canManage && (sticker?.kind === 'serial' || sticker?.kind === 'model')"
      block
      @click="emit('action', { kind: 'create-asset', fill })"
    >
      Add equipment with this code
    </BaseButton>
  </section>
</template>
