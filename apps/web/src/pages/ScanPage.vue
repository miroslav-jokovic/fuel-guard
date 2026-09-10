<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { AppButton as BaseButton, AppFormField as FormField, AppInput as BaseInput } from "@silvicom/ui";
import { useScanInput } from "@/composables/useScanInput";
import { useLocationsQuery } from "@/features/inventory/useInventory";
import { useScanQuery } from "@/features/inventory/useScan";
import ScanResultCard, { type ScanAction } from "@/features/inventory/ScanResultCard.vue";
import MovementDrawer, { type DeskVerb } from "@/features/inventory/MovementDrawer.vue";
import AssetMoveDrawer from "@/features/inventory/AssetMoveDrawer.vue";
import PartDrawer from "@/features/inventory/PartDrawer.vue";
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
 */

const router = useRouter();

/** The code being resolved. Empty is the idle screen, not an error. */
const code = ref("");
/** What the fallback field holds — separate from `code`, which is only ever a submitted value. */
const typed = ref("");

const { data: locations } = useLocationsQuery();
const { data: result, isFetching, isError, error, refetch } = useScanQuery(code);

const moving = ref<{ verb: DeskVerb; line: StockLineDto } | null>(null);
const assetAction = ref<{ mode: "move" | "report"; asset: AssetDto } | null>(null);
const creatingPartWith = ref<string | null>(null);

const drawerOpen = computed(
  () => moving.value !== null || assetAction.value !== null || creatingPartWith.value !== null,
);

const scanner = useScanInput({
  enabled: computed(() => !drawerOpen.value),
  onScan: (scanned) => {
    code.value = scanned;
  },
});

function submitTyped() {
  scanner.submit(typed.value);
  typed.value = "";
}

function act(action: ScanAction) {
  switch (action.kind) {
    case "stock":
      moving.value = { verb: action.verb, line: action.line };
      return;
    case "asset":
      assetAction.value = { mode: action.mode, asset: action.asset };
      return;
    case "create-part":
      creatingPartWith.value = action.upc;
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

    <p v-else-if="isError" class="text-sm text-ink">
      {{ error instanceof Error ? error.message : "Could not read that code." }}
    </p>

    <ScanResultCard v-else-if="result" :result="result" @action="act" />

    <!-- The idle screen. It names the hardware rather than describing a camera, because on this path
         there is no camera: the shop's scanner is a Bluetooth keyboard, and the only thing that can
         go wrong before a code arrives is that it is not paired. -->
    <div v-else class="rounded-control bg-surface-subtle px-4 py-6 text-center ring-1 ring-edge">
      <p class="text-sm font-semibold text-ink">Ready</p>
      <p class="mx-auto mt-1 max-w-sm text-sm text-ink-tertiary">
        If nothing happens when you scan, check the scanner is paired in Settings → Bluetooth. You
        can also type a code below.
      </p>
    </div>
  </div>

  <!-- The fallback, always rendered and never hidden behind a disclosure: a label that has fogged or
       peeled is the case it exists for, and that is not the moment to go looking for it. It sits in
       the bottom bar because that is where a thumb is (research §5.1).
       ⚠ On iOS a paired scanner suppresses the on-screen keyboard — double-press the trigger to get
       it back. The hint says so, because the alternative is a technician deciding the field is
       broken. -->
  <Teleport to="#shop-action-bar">
    <form class="flex items-end gap-2" @submit.prevent="submitTyped">
      <FormField v-slot="{ id }" label="Type a code" class="flex-1">
        <BaseInput :id="id" v-model="typed" autocapitalize="characters" autocomplete="off" />
      </FormField>
      <BaseButton type="submit" variant="primary" :disabled="!typed.trim()">Find</BaseButton>
    </form>
  </Teleport>

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
  <!-- Creating a part from an unrecognised barcode carries the code into the form (research §2.5:
       "attach or create" with the code kept, never a shrug). -->
  <PartDrawer
    v-if="creatingPartWith"
    :open="true"
    :initial-upc="creatingPartWith"
    @close="creatingPartWith = null"
    @saved="((creatingPartWith = null), refresh())"
  />
</template>
