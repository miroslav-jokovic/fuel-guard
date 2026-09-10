<script setup lang="ts">
import type { StockLineDto } from "@silvicom/shared";
import { AppButton as BaseButton } from "@silvicom/ui";
import StockLevelCell from "@/features/inventory/StockLevelCell.vue";
import type { DeskVerb } from "@/features/inventory/MovementDrawer.vue";

/**
 * One shelf, and what can be done to it, after a scan (INVENTORY-PLAN.md I6).
 *
 * ── ONE COMPONENT BECAUSE A SCAN CAN LAND ON ONE SHELF OR ON SEVERAL ──────────────────────────
 * A `BIN` tag resolves to exactly one stock line — one part at one location, which is the row the
 * label is stuck to. A supplier UPC resolves to a PART, and a part can sit in the tool crib and in
 * the bay both. Rendering the second case as a list of these means a technician who scans a carton
 * gets "Bay A: 11 · Crib: 2" with the verbs on each, and picks by tapping the one they are standing
 * in front of — rather than choosing a location from a picker after the fact, which asks them to
 * name a place they can see.
 *
 * ── FOUR VERBS, LED BY ISSUE ──────────────────────────────────────────────────────────────────
 * Research §5.2 caps a verb sheet at four and the plan's I6 fixes the order: on-hand first, then
 * Issue, Receive, Adjust, Transfer. Issue leads because it is the verb of the job — a technician
 * scans a bin because they are taking something out of it to put on a truck. Receive is second and
 * is the RECEIVING DESK's verb, and it stays manual-only by Q9's ruling: stock arriving against a
 * purchase order is received in FleetPal and ingested at I14, and `MovementDrawer` says so on the
 * form rather than leaving a technician to type a delivery twice.
 *
 * ⚠ Count is not here, and its absence is a decision rather than an omission. A count is a SESSION —
 * it opens, it is blind, it holds a queue, it closes irreversibly (D-INV19) — and starting one from
 * a verb row would put a technician mid-walk with no way back to the walk they were already on. It
 * is started from the shelf, on `/shop/inventory`, which is where the walk's own screen lives.
 *
 * ── THE BUTTONS TAKE THE SHIPPED PHONE SIZE, NOT THE ONE THE PLAN NAMES ───────────────────────
 * I6's step text says the verbs are `AppButton size="lg"`. There is no `lg` — `AppButton` offers
 * `sm` and `md` — and the screen that already does this job on a phone, `UnitCheck.vue`, uses
 * `block variant="primary"` at the default size and was signed off on a real device. The call site
 * is the authority over the plan's prose here, and `block` is what actually delivers the tap target:
 * a full-width button is far past the 48 dp floor in the axis a thumb misses in.
 */
defineProps<{ line: StockLineDto }>();
const emit = defineEmits<{ verb: [verb: DeskVerb] }>();

/** Fixed order, and it does not reorder itself between scans — see the header. */
const VERBS: { verb: DeskVerb; label: string; lead?: boolean }[] = [
  { verb: "issued", label: "Issue", lead: true },
  { verb: "received", label: "Receive" },
  { verb: "adjusted", label: "Adjust" },
  { verb: "transferred", label: "Move" },
];
</script>

<template>
  <div class="rounded-control bg-surface-subtle px-3 py-3 ring-1 ring-edge">
    <div class="flex items-baseline justify-between gap-3">
      <p class="min-w-0 truncate text-sm font-semibold text-ink">{{ line.locationName }}</p>
      <StockLevelCell :line="line" />
    </div>
    <p class="mt-0.5 text-xs text-ink-tertiary">
      {{ line.unitOfMeasure }}<template v-if="line.tagCode"> · {{ line.tagCode }}</template>
    </p>

    <div class="mt-3 grid grid-cols-2 gap-2">
      <BaseButton
        v-for="v in VERBS"
        :key="v.verb"
        block
        :variant="v.lead ? 'primary' : 'secondary'"
        @click="emit('verb', v.verb)"
      >
        {{ v.label }}
      </BaseButton>
    </div>
  </div>
</template>
