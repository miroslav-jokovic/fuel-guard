<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import {
  ASSET_MOVEMENT_REASONS,
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
  AppSelect,
  AppTextarea as BaseTextarea,
} from "@silvicom/ui";
import SlideOver from "@/components/SlideOver.vue";
import { useVehiclesQuery } from "@/composables/useVehicles";
import { useTrailersQuery } from "@/composables/useTrailers";
import { useMoveAsset } from "./useAssets";
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

/** Minted ONCE, here — see the header. Not in the submit handler, and not in the hook. */
const movementId = crypto.randomUUID();
/** Fixed at the first submit and reused, so a retry is the same movement at the same moment. */
const occurredAt = ref<string | null>(null);

/** The reasons this drawer offers, split by the one function that owns the split. */
const reasons = computed<AssetMovementReason[]>(() =>
  ASSET_MOVEMENT_REASONS.filter((r) => movesHolder(r) === (props.mode === "move")),
);

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
const asksWhere = computed(() => props.mode === "move" && form.reason !== "retired");

const errors = ref<Record<string, string>>({});

function payload(): unknown {
  const [kind, id] = form.holder.split(":");
  return {
    id: movementId,
    assetId: props.asset.id,
    reason: form.reason,
    toLocationId: asksWhere.value && kind === "location" ? id : null,
    toVehicleId: asksWhere.value && kind === "vehicle" ? id : null,
    toTrailerId: asksWhere.value && kind === "trailer" ? id : null,
    condition: form.condition === "" ? undefined : form.condition,
    note: form.note.trim() === "" ? null : form.note,
    occurredAt: occurredAt.value,
  };
}

async function submit() {
  occurredAt.value ??= new Date().toISOString();
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
    toast.success(props.mode === "move" ? "Moved" : "Recorded");
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
    :title="mode === 'move' ? 'Move this asset' : 'Report a problem'"
    @close="emit('close')"
  >
    <form class="space-y-4" @submit.prevent="submit">
      <div class="rounded-control bg-surface-subtle px-3 py-2.5 ring-1 ring-edge">
        <p class="text-sm font-medium text-ink">{{ asset.displayNo }} — {{ asset.name }}</p>
        <p class="mt-0.5 text-xs text-ink-muted">
          {{ asset.assetTypeName }} ·
          {{ asset.holder.label ? `with ${asset.holder.label}` : "nowhere yet" }}
        </p>
      </div>

      <FormField v-slot="{ id }" label="What happened" :error="errors.reason">
        <AppSelect
          :id="id"
          v-model="form.reason"
          :options="reasons.map((r) => ({ value: r, label: ASSET_MOVEMENT_REASON_LABELS[r] }))"
        />
      </FormField>

      <FormField
        v-if="asksWhere"
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
          empty-text="No bays or units to move it to."
        />
      </FormField>

      <!-- Retiring says so out loud, because 0333 refuses every later movement against a retired
           asset (`IV023`). The screen should not discover that on the next move. -->
      <p v-if="form.reason === 'retired'" class="text-xs text-ink-tertiary">
        Retiring is final: it comes off its unit and nothing can be recorded against it afterwards.
        Its history stays, and its number is never reused.
      </p>

      <FormField v-slot="{ id }" label="Condition" hint="Optional. Leave it if nothing changed.">
        <AppSelect
          :id="id"
          v-model="form.condition"
          :options="[
            { value: '', label: 'Unchanged' },
            ...ITEM_CONDITIONS.map((c) => ({ value: c, label: ITEM_CONDITION_LABELS[c] })),
          ]"
        />
      </FormField>

      <FormField v-slot="{ id }" label="Note">
        <BaseTextarea :id="id" v-model="form.note" :rows="2" />
      </FormField>

      <div class="flex justify-end gap-2 pt-2">
        <BaseButton type="button" @click="emit('close')">Cancel</BaseButton>
        <BaseButton type="submit" variant="primary" :disabled="record.isPending.value">
          {{ mode === "move" ? "Move it" : "Record it" }}
        </BaseButton>
      </div>
    </form>
  </SlideOver>
</template>
