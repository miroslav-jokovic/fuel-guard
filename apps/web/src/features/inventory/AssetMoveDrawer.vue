<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import {
  ASSET_MOVEMENT_REASONS,
  DRIVER_STATUSES_THAT_TAKE_A_TABLET,
  ASSET_MOVEMENT_REASON_LABELS,
  ITEM_CONDITIONS,
  ITEM_CONDITION_LABELS,
  moveAssetSchema,
  movesHolder,
  reportAssetSchema,
  type AssetDto,
  type AssetMovementInput,
  type AssetMovementReason,
  type StockLocationDto,
} from "@silvicom/shared";
import {
  AppButton as BaseButton,
  AppCombobox,
  AppFormField as FormField,
  AppSegmentedControl,
  AppTextarea as BaseTextarea,
} from "@silvicom/ui";
import SlideOver from "@/components/SlideOver.vue";
import { useVehiclesQuery } from "@/composables/useVehicles";
import { useTrailersQuery } from "@/composables/useTrailers";
import { useDriversQuery } from "@/composables/useDrivers";
import { useAssetTypesQuery, useMoveAsset } from "./useAssets";
import {
  TABLET_VERB_LABELS,
  defaultReturnBay,
  defaultTabletVerb,
  isDriverHeld,
  tabletReason,
  tabletVerbs,
  type TabletVerb,
} from "./driverHeldMove";
import { useToastStore } from "@/stores/toast";

/**
 * Move an asset, or report something about one (INVENTORY-PLAN.md I8, D-INV24).
 *
 * ── ⚠ THE MOVEMENT ID IS MINTED ONCE PER MOVEMENT, NOT ONCE PER ATTEMPT (D-INV27) ─────────────
 * `MovementDrawer.vue`'s rule, and it is exactly as easy to get wrong here and exactly as invisible
 * to every test. The id IS the idempotency key: `move_asset` returns the row it already has for an
 * id it has seen, which is what makes a replayed write free. So it is minted when the drawer opens
 * and reused for every retry of the same form — a failed submit that the technician corrects and
 * sends again is the SAME movement. Minting inside the submit handler would make each retry a new
 * one, and a tablet would appear to have moved once for every time the network was bad.
 *
 * `occurredAt` is fixed at the FIRST submit for the same reason and not at open: a drawer left up
 * for an hour records when the technician acted, and a retry must not re-clock it.
 *
 * ── ONE DRAWER, TWO VERBS, AND THE DESTINATION DISAPPEARS FOR ONE OF THEM ─────────────────────
 * A report is a person's claim about a thing, not a move of it: a fridge reported missing from 654
 * is still 654's fridge, missing from it, and that is precisely what the next kit check needs to be
 * told. The rule is `movesHolder`'s, asked here rather than restated — the same function chooses
 * the endpoint, narrows the two contract schemas and tones the history rail. `reportAssetSchema`
 * refuses a destination and 0333's CHECK refuses the row, so this is the third of three places the
 * one rule holds, not a fourth statement of it.
 *
 * ── A DRIVER'S TABLET MOVES BY VERB, NOT BY REASON (DE2b, D-DE1) ──────────────────────────────
 * A `held_by = 'driver'` type is given to a driver, returned to the shop, or retired — three verbs,
 * each choosing its own ledger reason (`driverHeldMove.ts` says why). Its picker lists drivers or bays,
 * never a truck or trailer, because 0524 refuses those (`IV025`); a truck's equipment never sees a
 * driver for the same reason. The drivers offered are `DRIVER_STATUSES_THAT_TAKE_A_TABLET` — the pair
 * `IV012` admits — so the list cannot hold a name the database will refuse. Reports are unchanged:
 * a tablet reported missing is still the driver's, missing from them.
 */

const props = defineProps<{
  open: boolean;
  asset: AssetDto;
  /** Fixed at open: `move` offers every holder, `report` offers none. */
  mode: "move" | "report";
  /** Active locations only — a placement into a closed bay is refused by 0333 (`IV012`). */
  locations: StockLocationDto[];
}>();
const emit = defineEmits<{ close: [] }>();

const toast = useToastStore();
const record = useMoveAsset();
const { data: vehicles } = useVehiclesQuery();
const { data: trailers } = useTrailersQuery();
const { data: types } = useAssetTypesQuery();
const { data: drivers } = useDriversQuery();

/** A driver-held type's move is the three verbs; its report is the same as anybody's. */
const tablet = computed(() => props.mode === "move" && isDriverHeld(props.asset, types.value));
const verbOptions = computed(() => tabletVerbs(props.asset).map((v) => ({ value: v, label: TABLET_VERB_LABELS[v] })));
const verb = ref<TabletVerb>(defaultTabletVerb(props.asset));
const driverOptions = computed(() =>
  (drivers.value ?? [])
    .filter((d) => !d.archived_at && (DRIVER_STATUSES_THAT_TAKE_A_TABLET as readonly string[]).includes(d.status))
    // Handing it to the driver who already has it is not a move; 0524 would write a row saying it was.
    .filter((d) => !(props.asset.holder.kind === "driver" && props.asset.holder.id === d.id))
    .map((d) => ({ value: `driver:${d.id}`, label: d.full_name })),
);
const bayOptions = computed(() =>
  props.locations.map((l) => ({ value: `location:${l.id}`, label: `${l.name} (${l.code})` })),
);

/** Minted ONCE, here — see the header. Not in the submit handler, and not in the hook. */
const movementId = crypto.randomUUID();
/** Fixed at the first submit and reused, so a retry is the same movement at the same moment. */
const occurredAt = ref<string | null>(null);

/** The footer submits the form by id — `PartForm.vue` records why the buttons are not in the body. */
const FORM_ID = "asset-move-form";

/** The reasons this drawer offers, split by the one function that owns the split. */
const reasons = computed<AssetMovementReason[]>(() =>
  ASSET_MOVEMENT_REASONS.filter((r) => movesHolder(r) === (props.mode === "move")),
);
const reasonOptions = computed(() =>
  reasons.value.map((r) => ({ value: r, label: ASSET_MOVEMENT_REASON_LABELS[r] })),
);
/** "" is "unchanged", which is a real answer and the usual one, so it is an option and the placeholder. */
const CONDITION_OPTIONS = [
  { value: "", label: "Unchanged" },
  ...ITEM_CONDITIONS.map((c) => ({ value: c, label: ITEM_CONDITION_LABELS[c] })),
];

const form = reactive({
  reason: (props.mode === "move" ? "assigned" : "reported_missing") as AssetMovementReason,
  /** `location:<id>` / `vehicle:<id>` / `trailer:<id>`, or "" for nowhere. */
  holder: "",
  condition: "",
  note: "",
});

/**
 * Bays, trucks and trailers in one list, because an asset is in exactly one place and a technician
 * does not think in three pickers. The value carries which kind it is, so the payload can name the
 * right column — the contract refuses a row naming two.
 */
const holderOptions = computed(() => [
  ...props.locations.map((l) => ({ value: `location:${l.id}`, label: `${l.name} (${l.code})` })),
  ...(vehicles.value ?? []).map((v) => ({ value: `vehicle:${v.id}`, label: `Truck ${v.unit_number}` })),
  ...(trailers.value ?? []).map((t) => ({ value: `trailer:${t.id}`, label: `Trailer ${t.unit_number}` })),
]);

/**
 * `retired` clears the holder, so the picker would be a lie: 0333 nulls all three columns for it
 * whatever the payload says. Hiding the field is how the screen agrees with the RPC instead of
 * offering a choice the database will overrule.
 */
const asksWhere = computed(() =>
  tablet.value ? verb.value !== "retire" : props.mode === "move" && form.reason !== "retired",
);

/**
 * The verb owns the reason and resets the destination: a driver picked for Give is not a bay for
 * Return. Return opens on the shop's only bay when it has one (`defaultReturnBay`).
 */
watch(
  [tablet, verb],
  () => {
    if (!tablet.value) return;
    form.reason = tabletReason(verb.value, props.asset);
    const bay = defaultReturnBay(props.locations);
    form.holder = verb.value === "return" && bay ? `location:${bay}` : "";
  },
  { immediate: true },
);

const errors = ref<Record<string, string>>({});

const submitLabel = computed(() => {
  if (props.mode === "report") return "Record it";
  if (tablet.value) return { give: "Give it", return: "Return it", retire: "Retire it" }[verb.value];
  return "Move it";
});

function payload(): unknown {
  const [kind, id] = form.holder.split(":");
  return {
    id: movementId,
    assetId: props.asset.id,
    reason: form.reason,
    toLocationId: asksWhere.value && kind === "location" ? id : null,
    toVehicleId: asksWhere.value && kind === "vehicle" ? id : null,
    toTrailerId: asksWhere.value && kind === "trailer" ? id : null,
    toDriverId: asksWhere.value && kind === "driver" ? id : null,
    condition: form.condition === "" ? undefined : form.condition,
    note: form.note.trim() === "" ? null : form.note,
    occurredAt: occurredAt.value,
  };
}

async function submit() {
  occurredAt.value ??= new Date().toISOString();
  // Give names a driver. The contract allows "nowhere" for a move, and that is a real answer for a
  // truck's equipment — but a hand-over to nobody is not one, so the screen asks rather than sending it.
  if (tablet.value && verb.value === "give" && !form.holder) {
    errors.value = { toLocationId: "Pick the driver who takes it." };
    return;
  }
  const schema = props.mode === "move" ? moveAssetSchema : reportAssetSchema;
  const parsed = schema.safeParse(payload());
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
    await record.mutateAsync(parsed.data as AssetMovementInput);
    toast.success(tablet.value ? { give: "Given", return: "Returned", retire: "Retired" }[verb.value] : props.mode === "move" ? "Moved" : "Recorded");
    emit("close");
  } catch (e) {
    // The API's own sentence. `IV020` says the truck already carries the one it is expected to
    // carry and `IV023` says the thing has been retired — replacing either with "Could not record"
    // throws away the half that says what to do.
    toast.error(props.mode === "move" ? "Could not move it" : "Could not record it", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <SlideOver
    :open="open"
    :title="mode === 'report' ? 'Report a problem' : tablet ? 'Give or return' : 'Move this'"
    @close="emit('close')"
  >
    <form :id="FORM_ID" class="space-y-4" @submit.prevent="submit">
      <div class="rounded-control bg-surface-subtle px-3 py-2.5 ring-1 ring-edge">
        <p class="text-sm font-medium text-ink">{{ asset.displayNo }} — {{ asset.name }}</p>
        <p class="mt-0.5 text-xs text-ink-muted">
          {{ asset.assetTypeName }} ·
          {{ asset.holder.label ? `with ${asset.holder.label}` : "nowhere yet" }}
          <span v-if="asset.holder.notReturned" class="font-medium text-danger-700"> · not returned</span>
        </p>
      </div>

      <template v-if="tablet">
        <AppSegmentedControl v-model="verb" :options="verbOptions" label="What to do with it" />
        <FormField v-if="verb === 'give'" v-slot="{ id }" label="Driver" :error="errors.toLocationId">
          <AppCombobox
            :id="id"
            v-model="form.holder"
            :options="driverOptions"
            placeholder="Who takes it"
            empty-text="No active or on-leave drivers."
          />
        </FormField>
        <FormField
          v-else-if="verb === 'return'"
          v-slot="{ id }"
          label="Where it goes in the shop"
          hint="Leave empty if it has not been put on a shelf yet."
          :error="errors.toLocationId"
        >
          <AppCombobox :id="id" v-model="form.holder" :options="bayOptions" placeholder="A bay" empty-text="No bays yet." />
        </FormField>
      </template>

      <FormField v-if="!tablet" v-slot="{ id }" label="What happened" :error="errors.reason">
        <AppCombobox :id="id" v-model="form.reason" :options="reasonOptions" placeholder="What happened to it" />
      </FormField>

      <FormField
        v-if="asksWhere && !tablet"
        v-slot="{ id }"
        label="Where it goes"
        hint="Leave empty to take it out of service without putting it anywhere."
        :error="errors.toLocationId"
      >
        <AppCombobox
          :id="id"
          v-model="form.holder"
          :options="holderOptions"
          placeholder="A bay, a truck or a trailer"
          empty-text="No bays, trucks or trailers to move it to."
        />
      </FormField>

      <!-- Retiring says so out loud, because 0333 refuses every later movement against a retired
           asset (`IV023`). The screen should not discover that on the next move. -->
      <p v-if="form.reason === 'retired'" class="text-xs text-ink-tertiary">
        Retiring is final: it comes off its unit and nothing can be recorded against it afterwards.
        Its history stays, and its number is never reused.
      </p>

      <FormField v-slot="{ id }" label="Condition" hint="Optional. Leave it if nothing changed.">
        <AppCombobox :id="id" v-model="form.condition" :options="CONDITION_OPTIONS" placeholder="Unchanged" />
      </FormField>

      <FormField v-slot="{ id }" label="Note">
        <BaseTextarea :id="id" v-model="form.note" :rows="2" />
      </FormField>
    </form>
    <template #footer>
      <div class="flex items-center justify-end gap-3">
        <BaseButton variant="ghost" :disabled="record.isPending.value" @click="emit('close')">Cancel</BaseButton>
        <BaseButton :form="FORM_ID" type="submit" variant="primary" :disabled="record.isPending.value">
          {{ record.isPending.value ? "Saving…" : submitLabel }}
        </BaseButton>
      </div>
    </template>
  </SlideOver>
</template>
