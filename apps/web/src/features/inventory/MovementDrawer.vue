<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import {
  ADJUST_REASONS,
  ADJUST_REASON_LABELS,
  adjustStockSchema,
  issueStockSchema,
  receiveStockSchema,
  transferStockSchema,
  type PartMovementInput,
  type StockLineDto,
  type StockLocationDto,
} from "@silvicom/shared";
import {
  AppButton as BaseButton,
  AppCombobox,
  AppFormField as FormField,
  AppInput as BaseInput,
  AppSelect,
  AppTextarea as BaseTextarea,
} from "@silvicom/ui";
import SlideOver from "@/components/SlideOver.vue";
import { useVehiclesQuery } from "@/composables/useVehicles";
import { useTrailersQuery } from "@/composables/useTrailers";
import { useRecordMovement } from "./useInventory";
import { useToastStore } from "@/stores/toast";

/**
 * The four desk verbs — receive, issue, adjust, transfer (INVENTORY-PLAN.md I5 PR 2a).
 *
 * ── ⚠ THE MOVEMENT ID IS MINTED ONCE PER MOVEMENT, NOT ONCE PER ATTEMPT (D-INV27) ─────────────
 * This is the single easiest thing in the feature to get wrong, and getting it wrong breaks no
 * test. The id IS the idempotency key: `record_part_movement` returns the row it already has for an
 * id it has seen, which is what makes a replayed write free. So it is minted when the drawer opens
 * and reused for every retry of the same form — a failed submit that the technician corrects and
 * sends again is the SAME movement, and the server must be able to say so. Minting inside the
 * submit handler would make each retry a new movement, and the shelf would drift by exactly the
 * number of times the network was bad.
 *
 * `occurredAt` is fixed at the FIRST submit for the same reason and not at open: a drawer left up
 * for an hour should record when the technician acted, and a retry must not re-clock it.
 *
 * ── ONE DRAWER, FOUR VERBS ────────────────────────────────────────────────────────────────────
 * Four files would be four copies of the paragraph above, which is how three of them end up right
 * and one does not. The verbs differ in three or four fields and in nothing else: the part and the
 * location come from the shelf row this opened from, because a movement is about one shelf.
 *
 * ── THE SHAPES ARE THE RULES ──────────────────────────────────────────────────────────────────
 * Each verb validates against its own schema from `@silvicom/shared` — the same one the API's route
 * uses — so an issue cannot be built without a unit and an adjustment cannot be built without a
 * reason. Nothing here re-states those rules; `submit()` picks the schema and reports what it says.
 */

export type DeskVerb = "received" | "issued" | "adjusted" | "transferred";

const props = defineProps<{
  open: boolean;
  verb: DeskVerb;
  line: StockLineDto;
  /** Active locations, for a transfer's destination. */
  locations: StockLocationDto[];
}>();
const emit = defineEmits<{ close: [] }>();

const toast = useToastStore();
const record = useRecordMovement();
const { data: vehicles } = useVehiclesQuery();
const { data: trailers } = useTrailersQuery();

/** Minted ONCE, here — see the header. Not in the submit handler, and not in the hook. */
const movementId = crypto.randomUUID();
/** Fixed at the first submit and reused, so a retry is the same movement at the same moment. */
const occurredAt = ref<string | null>(null);

const TITLES: Record<DeskVerb, string> = {
  received: "Receive stock",
  issued: "Issue a part",
  adjusted: "Adjust the count",
  transferred: "Move stock",
};

const form = reactive({
  quantity: "",
  unitCost: "",
  supplier: "",
  unit: "",
  workOrderRef: "",
  delta: "",
  adjustReason: "correction" as (typeof ADJUST_REASONS)[number],
  toLocationId: "",
  note: "",
});

/**
 * Trucks and trailers in one list, because D-INV5 issues a part to exactly one unit and a technician
 * does not think in two pickers. The value carries which kind it is, so the payload can name the
 * right column — `issueStockSchema` refuses a row naming both.
 */
const unitOptions = computed(() => [
  ...(vehicles.value ?? []).map((v) => ({ value: `vehicle:${v.id}`, label: `Truck ${v.unit_number}` })),
  ...(trailers.value ?? []).map((t) => ({ value: `trailer:${t.id}`, label: `Trailer ${t.unit_number}` })),
]);

const destinations = computed(() =>
  props.locations
    .filter((l) => l.id !== props.line.locationId)
    .map((l) => ({ value: l.id, label: `${l.name} (${l.code})` })),
);

const errors = ref<Record<string, string>>({});
const blank = (v: string) => (v.trim() === "" ? null : v);
const int = (v: string) => (v.trim() === "" ? Number.NaN : Number(v));

/** The payload for this verb, in the contract's own shape. Nothing here decides a rule. */
function payload(): unknown {
  const base = {
    id: movementId,
    partId: props.line.partId,
    locationId: props.line.locationId,
    occurredAt: occurredAt.value,
    note: blank(form.note),
  };
  switch (props.verb) {
    case "received":
      return {
        ...base,
        reason: "received",
        quantity: int(form.quantity),
        unitCost: form.unitCost.trim() === "" ? null : Number(form.unitCost),
        supplier: blank(form.supplier),
      };
    case "issued": {
      const [kind, id] = form.unit.split(":");
      return {
        ...base,
        reason: "issued",
        quantity: int(form.quantity),
        vehicleId: kind === "vehicle" ? id : null,
        trailerId: kind === "trailer" ? id : null,
        workOrderRef: blank(form.workOrderRef),
      };
    }
    case "adjusted":
      return { ...base, reason: "adjusted", quantityDelta: int(form.delta), adjustReason: form.adjustReason };
    case "transferred":
      return { ...base, reason: "transferred", quantity: int(form.quantity), toLocationId: form.toLocationId };
  }
}

const SCHEMAS = {
  received: receiveStockSchema,
  issued: issueStockSchema,
  adjusted: adjustStockSchema,
  transferred: transferStockSchema,
} as const;

async function submit() {
  occurredAt.value ??= new Date().toISOString();
  const parsed = SCHEMAS[props.verb].safeParse(payload());
  if (!parsed.success) {
    const map: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string" && !map[key]) map[key] = issue.message;
    }
    errors.value = map;
    return;
  }
  errors.value = {};
  try {
    await record.mutateAsync(parsed.data as PartMovementInput);
    toast.success("Recorded");
    emit("close");
  } catch (e) {
    // The API's own sentence. Inventory's refusals are specific by design — 409 means the shelf
    // refuses a fine payload ("there is one left"), 422 means the payload names something unusable —
    // and replacing them with "Could not record" throws away the half that says what to do.
    toast.error("Could not record it", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <SlideOver :open="open" :title="TITLES[verb]" @close="emit('close')">
    <form class="space-y-4" @submit.prevent="submit">
      <div class="rounded-control bg-surface-subtle px-3 py-2.5 ring-1 ring-edge">
        <p class="text-sm font-medium text-ink">{{ line.partNumber }} — {{ line.partDescription }}</p>
        <p class="mt-0.5 text-xs text-ink-muted">
          {{ line.locationName }} · {{ line.quantityOnHand }} on hand
        </p>
      </div>

      <!-- Q9, ruled by the owner 2026-09-09: stock arriving is received in FleetPal and ingested,
           and this verb is the manual path for what was bought outside a purchase order. Saying so
           here is the whole point of the ruling — the failure it prevents is a shop that types every
           delivery in both systems out of habit. -->
      <p v-if="verb === 'received'" class="text-xs text-ink-tertiary">
        For stock bought outside a purchase order. Deliveries received against a PO in FleetPal
        arrive on their own.
      </p>

      <FormField
        v-if="verb !== 'adjusted'"
        v-slot="{ id }"
        label="Quantity"
        :error="errors.quantity"
      >
        <BaseInput :id="id" v-model="form.quantity" inputmode="numeric" :invalid="!!errors.quantity" />
      </FormField>

      <template v-if="verb === 'received'">
        <div class="grid grid-cols-2 gap-3">
          <FormField v-slot="{ id }" label="Unit cost" hint="What one costs. Optional." :error="errors.unitCost">
            <BaseInput :id="id" v-model="form.unitCost" inputmode="decimal" :invalid="!!errors.unitCost" />
          </FormField>
          <FormField v-slot="{ id }" label="Supplier" :error="errors.supplier">
            <BaseInput :id="id" v-model="form.supplier" placeholder="TruckPro" />
          </FormField>
        </div>
      </template>

      <template v-if="verb === 'issued'">
        <FormField v-slot="{ id }" label="Onto which unit" :error="errors.vehicleId">
          <AppCombobox
            :id="id"
            v-model="form.unit"
            :options="unitOptions"
            placeholder="Truck or trailer"
            empty-text="No units on the roster."
          />
        </FormField>
        <FormField v-slot="{ id }" label="Work order" hint="FleetPal's reference, as the shop sees it. Optional.">
          <BaseInput :id="id" v-model="form.workOrderRef" placeholder="SH-1042" />
        </FormField>
      </template>

      <template v-if="verb === 'adjusted'">
        <FormField
          v-slot="{ id }"
          label="Change"
          hint="Signed: −2 for two damaged, +1 for one found."
          :error="errors.quantityDelta"
        >
          <BaseInput :id="id" v-model="form.delta" inputmode="numeric" :invalid="!!errors.quantityDelta" />
        </FormField>
        <!-- Mandatory, and a closed list. Research §2.5: every good product in the category makes an
             unexplained decrease impossible, because an inventory anybody can quietly write down is
             an inventory nobody trusts. The contract refuses the row without it. -->
        <FormField v-slot="{ id }" label="Why" :error="errors.adjustReason">
          <AppSelect
            :id="id"
            v-model="form.adjustReason"
            :options="ADJUST_REASONS.map((r) => ({ value: r, label: ADJUST_REASON_LABELS[r] }))"
          />
        </FormField>
      </template>

      <template v-if="verb === 'transferred'">
        <FormField v-slot="{ id }" label="To" :error="errors.toLocationId">
          <AppCombobox
            :id="id"
            v-model="form.toLocationId"
            :options="destinations"
            placeholder="Another location"
            empty-text="No other location to move it to."
          />
        </FormField>
      </template>

      <FormField v-slot="{ id }" label="Note">
        <BaseTextarea :id="id" v-model="form.note" :rows="2" />
      </FormField>

      <div class="flex justify-end gap-2 pt-2">
        <BaseButton type="button" @click="emit('close')">Cancel</BaseButton>
        <BaseButton type="submit" variant="primary" :disabled="record.isPending.value">
          {{ TITLES[verb] }}
        </BaseButton>
      </div>
    </form>
  </SlideOver>
</template>
