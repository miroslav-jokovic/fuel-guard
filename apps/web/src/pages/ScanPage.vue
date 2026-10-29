<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { AppButton as BaseButton, AppFormField as FormField, AppIcon, AppInput as BaseInput, ErrorState } from "@silvicom/ui";
import { ScanIcon } from "@silvicom/ui/icons";
import { useScanInput } from "@/composables/useScanInput";
import BarcodeCamera from "@/components/BarcodeCamera.vue";
import { SCAN_PAGE_READER } from "@/features/inventory/shopBarcodeFormats";
import { useLocationsQuery } from "@/features/inventory/useInventory";
import { useSessionStore } from "@/stores/session";
import { useScanQuery } from "@/features/inventory/useScan";
import ScanResultCard, { type ScanAction } from "@/features/inventory/ScanResultCard.vue";
import MovementDrawer, { type DeskVerb } from "@/features/inventory/MovementDrawer.vue";
import AssetMoveDrawer from "@/features/inventory/AssetMoveDrawer.vue";
import AssetDrawer from "@/features/inventory/AssetDrawer.vue";
import type { AssetFormSeed } from "@/features/inventory/AssetForm.vue";
import type { AssetDto, StockLineDto } from "@silvicom/shared";

/**
 * Scan a code, and do the thing (INVENTORY-PLAN.md I6; D-INV7, D-INV17).
 *
 * ── THIS IS THE HARDWARE-SCANNER HALF OF I6, AND IT SHIPS FIRST ───────────────────────────────
 * I6 has two input paths to the same `resolve → verb → write` loop: a Bluetooth HID scanner, which
 * is a keyboard and needs no permission, no WASM and no camera; and the phone camera, which needs
 * all three and is gated on A1 — whether the free decoder reads a greasy supplier UPC on the shop's
 * own phones. The owner ordered handheld scanners on 2026-09-10, which makes the hardware path the
 * one the shop will actually use at the receiving desk, and makes it buildable today against a
 * question nobody has to answer first. The camera lands behind this same loop; `useScanInput`'s
 * header carries the argument in full.
 *
 * ── THE ROUTE DOES NOT CHANGE WHILE THE SCANNER IS IN SOMEBODY'S HAND (D-INV17) ───────────────
 * Scan, resolve, verb sheet and write all happen here. The rule was written for the camera — an
 * installed web app is documented as re-asking for the camera on navigation — and it survives its
 * reason: a technician scanning a shelf of cartons is in a rhythm, and a screen that navigated away
 * on each one would break it four times a minute. The drawers are overlays, not routes, which is
 * what makes that possible; the two exceptions below are deliberate exits, taken once.
 *
 * ── THE VERBS ARE THE DESK'S OWN DRAWERS, UNCHANGED ───────────────────────────────────────────
 * `MovementDrawer` and `AssetMoveDrawer` are what `/shop/inventory/:id` and `/shop/assets/:id` open.
 * A phone-shaped copy of either would be a second place D-INV27's "mint the id once per movement,
 * not once per attempt" has to be got right, and that rule breaks no test when it is got wrong. One
 * owner, two entry points.
 *
 * ── WHY THE LISTENER IS SILENCED WHILE A DRAWER IS OPEN ───────────────────────────────────────
 * `enabled` goes false the moment a drawer opens. A scan landing while somebody is half way through
 * an issue form would replace the item under the form they are filling in — the value they already
 * typed staying put, against a part they are no longer looking at. The scanner beeps either way, so
 * the technician gets no signal that anything was ignored; that is acceptable and the alternative is
 * not, because a wrong write is silent and a missed scan is one more trigger pull.
 *
 * ── THE CAMERA, FOR WHEN THE HANDHELD IS NOT NEAR (M9c, 2026-10-29) ───────────────────────────
 * The camera half of I6, landed behind the same loop as the header above promised: the camera button in the
 * bottom bar opens `BarcodeCamera` as an overlay — never a route, D-INV17's reason in full — reading our QR
 * labels, a tablet's Code 128 and a carton's UPC. Its first read goes to `scanner.submit`, exactly where a
 * typed code goes, and the camera closes: one code is one lookup.
 */

const router = useRouter();

/** The code being resolved. Empty is the idle screen, not an error. */
const code = ref("");
/** Bumped by every scan, so the same label scanned twice asks again — see `useScanQuery`. */
const scanSeq = ref(0);
/** What the fallback field holds — separate from `code`, which is only ever a submitted value. */
const typed = ref("");

const { data: locations } = useLocationsQuery();
const { data: result, isFetching, isError, error, refetch } = useScanQuery(code, scanSeq);

const moving = ref<{ verb: DeskVerb; line: StockLineDto } | null>(null);
const assetAction = ref<{ mode: "move" | "report"; asset: AssetDto } | null>(null);
/** "Add this tablet": the code the scan read, carried into the Add equipment form (M9b). */
const cameraOpen = ref(false);
const creatingAssetWith = ref<AssetFormSeed | null>(null);

const drawerOpen = computed(
  () => moving.value !== null || assetAction.value !== null || creatingAssetWith.value !== null,
);

const scanner = useScanInput({
  enabled: computed(() => !drawerOpen.value),
  onScan: (scanned) => {
    code.value = scanned;
    scanSeq.value += 1;
  },
});

function submitTyped() {
  scanner.submit(typed.value);
  typed.value = "";
}

/**
 * A scanner set to end each read with Tab rather than Enter, firing while this field has focus,
 * types the code in and then moves focus away — the document listener ignores an editable target,
 * so nothing was ever submitted (DRIVER-EQUIPMENT-AND-UNIT-TAGS-PLAN.md §5, R11). Tab with text in
 * the field submits it; Tab in an empty field still moves focus, so keyboard navigation survives.
 */
function onFieldTab(event: KeyboardEvent) {
  if (!typed.value.trim()) return;
  event.preventDefault();
  submitTyped();
}

/**
 * Issue, Receive, Move and Create are writes, and the route is `maintenance: view` — an auditor
 * reaches this screen and used to be offered all four, each ending in a 403 (§5, R12). The matrix
 * answers, through the session store's door onto it.
 */
const session = useSessionStore();
const canManage = computed(() => session.can("maintenance"));

function act(action: ScanAction) {
  switch (action.kind) {
    case "stock":
      moving.value = { verb: action.verb, line: action.line };
      return;
    case "asset":
      assetAction.value = { mode: action.mode, asset: action.asset };
      return;
    case "create-asset":
      creatingAssetWith.value = action.fill;
      return;
    case "open-part":
      // One of the two deliberate exits. Adding a shelf is a decision about where stock lives, and
      // it belongs on the part's own page rather than in a sheet in front of a carton.
      void router.push(`/shop/inventory/${action.partId}`);
  }
}

/**
 * A write landed, so the answer on screen is now stale — the on-hand it shows is the figure from
 * before the issue. Re-scanning would be the honest refresh and it is one trigger pull, but a
 * technician who has just issued two filters wants to watch eleven become nine without doing
 * anything, and a stale number on a screen they are still looking at is the kind of thing that ends
 * with somebody counting the shelf by hand to see which figure was right.
 */
function refresh() {
  if (code.value) void refetch();
}
</script>

<template>
  <div class="space-y-4">
    <header>
      <h1 class="text-lg font-semibold text-ink">Scan</h1>
      <p class="mt-0.5 text-sm text-ink-secondary">
        Pull the trigger on the scanner. Whatever it reads lands here.
      </p>
    </header>

    <p v-if="isFetching" class="text-sm text-ink-tertiary">Looking it up…</p>

    <!-- The product's error state, not a bare paragraph: it carries the retry, which on this
         screen is the difference between "scan it again" and "walk to a desk". -->
    <!-- ui-adoption: server-message — a code nobody knows is answered by the lookup in its own words. -->
    <ErrorState
      v-else-if="isError"
      :message="error instanceof Error ? error.message : 'Could not read that code.'"
      :retrying="isFetching"
      @retry="() => refetch()"
    />

    <ScanResultCard v-else-if="result" :result="result" :can-manage="canManage" @action="act" />

    <!-- The idle screen. It names the hardware rather than describing a camera, because on this path
         there is no camera: the shop's scanner is a Bluetooth keyboard, and the only thing that can
         go wrong before a code arrives is that it is not paired. -->
    <div v-else class="rounded-control bg-surface-subtle px-4 py-6 text-center ring-1 ring-edge">
      <p class="text-sm font-semibold text-ink">Ready</p>
      <p class="mx-auto mt-1 max-w-sm text-sm text-ink-tertiary">
        If nothing happens when you scan, check the scanner is connected — paired in Bluetooth
        settings, or its USB receiver plugged in. You can also type the code printed on the label
        below, or use the camera beside it.
      </p>
    </div>
  </div>

  <!-- The fallback, always rendered and never hidden behind a disclosure: a label that has fogged or
       peeled is the case it exists for, and that is not the moment to go looking for it. It sits in
       the bottom bar because that is where a thumb is (research §5.1).
       ⚠ A paired scanner suppresses the on-screen keyboard — on iOS double-press the trigger to get
       it back, on Android turn on "Use on-screen keyboard" under the physical keyboard settings. The
       hint says so, because the alternative is a technician deciding the field is broken. -->
  <!-- `defer` (Vue 3.5): `ShopLayout` draws `#shop-action-bar` AFTER its slot, so without it this
       Teleport looked for its target before it existed — in a production build its children never
       mounted, the typed fallback was missing, and the next re-render threw "reading 'emitsOptions'",
       which is why Move, Report, Issue and Add opened nothing on this page (found in M9b's browser
       pass, 2026-10-29). -->
  <Teleport defer to="#shop-action-bar">
    <form class="flex items-end gap-2" @submit.prevent="submitTyped">
      <FormField
        v-slot="{ id }"
        label="Type a code"
        hint="Keyboard hidden? iPhone: double-press the trigger. Android: Settings → Keyboard → on-screen keyboard."
        class="flex-1"
      >
        <BaseInput
          :id="id"
          v-model="typed"
          autocapitalize="characters"
          autocomplete="off"
          @keydown.tab="onFieldTab"
        />
      </FormField>
      <BaseButton type="button" variant="secondary" aria-label="Use the camera" title="Use the camera" data-test="scan-camera" @click="cameraOpen = true">
        <AppIcon :icon="ScanIcon" class="size-5" aria-hidden="true" />
      </BaseButton>
      <BaseButton type="submit" variant="primary" :disabled="!typed.trim()">Find</BaseButton>
    </form>
  </Teleport>

  <BarcodeCamera
    v-if="cameraOpen"
    title="Scan"
    hint="Hold the label or barcode inside the box."
    :reader="SCAN_PAGE_READER"
    once
    @read="(text) => scanner.submit(text)"
    @close="cameraOpen = false"
  />
  <MovementDrawer
    v-if="moving"
    :open="true"
    :verb="moving.verb"
    :line="moving.line"
    :locations="locations ?? []"
    @close="((moving = null), refresh())"
  />
  <AssetMoveDrawer
    v-if="assetAction"
    :open="true"
    :asset="assetAction.asset"
    :mode="assetAction.mode"
    :locations="locations ?? []"
    @close="((assetAction = null), refresh())"
  />
  <!-- An unrecognised IMEI, serial or model carries into Add equipment (research §2.5: "attach or
       create" with the code kept, never a shrug). Shop parts are FleetPal's since M8, so there is no
       "create a part" any more. On close, the same code is asked again — now it finds the tablet. -->
  <AssetDrawer
    v-if="creatingAssetWith"
    :open="true"
    :initial="creatingAssetWith"
    @close="((creatingAssetWith = null), refresh())"
  />
</template>
